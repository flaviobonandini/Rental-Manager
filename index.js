const express = require('express');
const bcrypt = require("bcrypt");
const app = express();
app.use(express.json());
const db = require("./server/db/db");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const PORT = process.env.PORT || 5000;

const path = require('path');
const multer = require('multer');
const uploadsDirectory = path.join(__dirname, 'server', 'uploads');
const storage = multer.diskStorage({
    destination: function (req, file, cb) {

        cb(
            null,
            path.join(uploadsDirectory, 'logos')
        );

    },

    filename: function (req, file, cb) {

        const uniqueName =
            Date.now() + '-' + file.originalname;

        cb(null, uniqueName);

    }

});

const JWT_SECRET = process.env.JWT_SECRET;

function authenticateToken(req, res, next) {

    const authHeader = req.headers["authorization"];

    const token =
        authHeader &&
        authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Missing token"
        });
    }

    jwt.verify(
        token,
        JWT_SECRET,
        (error, user) => {

            if (error) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid or expired token"
                });
            }

            req.user = user;

            next();
        }
    );
}

function requireAdmin(req, res, next) {

    const role = String(req.user?.role || "").toLowerCase();

    if (
        role !== "admin" &&
        role !== "superadmin"
    ) {
        return res.status(403).json({
            success: false,
            message: "Access restricted to administrators"
        });
    }

    next();
}

async function nextRentalNumber(conn) {
    const today = new Date();
    const pad = value => String(value).padStart(2, "0");
    const datePart = `${pad(today.getDate())}${pad(today.getMonth() + 1)}${String(today.getFullYear()).slice(-2)}`;
    const rentalPrefix = `RTS-${datePart}-`;
    const numberPattern = `^RTS-${datePart}-[0-9]{4}$`;
    const sequences = await conn.query(`
        SELECT MAX(CAST(SUBSTRING(rental_number, ?) AS UNSIGNED)) AS last_sequence
        FROM rental_service
        WHERE rental_number LIKE ?
          AND rental_number REGEXP ?
    `, [rentalPrefix.length + 1, `${rentalPrefix}%`, numberPattern]);
    const nextSequence = Number(sequences[0]?.last_sequence || 0) + 1;

    if (nextSequence > 9999) {
        return null;
    }

    return `${rentalPrefix}${String(nextSequence).padStart(4, "0")}`;
}

async function nextProductRentalNumber(conn) {
    const today = new Date();
    const pad = value => String(value).padStart(2, "0");
    const datePart = `${pad(today.getDate())}${pad(today.getMonth() + 1)}${String(today.getFullYear()).slice(-2)}`;
    const rentalPrefix = `RTP-${datePart}-`;
    const numberPattern = `^RTP-${datePart}-[0-9]{4}$`;
    const sequences = await conn.query(`
        SELECT MAX(CAST(SUBSTRING(rental_number, ?) AS UNSIGNED)) AS last_sequence
        FROM rental_product
        WHERE rental_number LIKE ?
          AND rental_number REGEXP ?
    `, [rentalPrefix.length + 1, `${rentalPrefix}%`, numberPattern]);
    const nextSequence = Number(sequences[0]?.last_sequence || 0) + 1;

    if (nextSequence > 9999) {
        return null;
    }

    return `${rentalPrefix}${String(nextSequence).padStart(4, "0")}`;
}

function isValidRentalSlot(startDate, stopDate) {
    if (
        typeof startDate !== "string" ||
        typeof stopDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T(?:0[8]|1[0-8]):00$/.test(startDate) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(stopDate)
    ) {
        return false;
    }

    if (!isValidDateOnly(startDate.slice(0, 10))) {
        return false;
    }

    const [year, month, day] = startDate.slice(0, 10).split("-").map(Number);
    const hour = Number(startDate.slice(11, 13));
    const expectedStop = new Date(Date.UTC(year, month - 1, day, hour + 1));
    const pad = value => String(value).padStart(2, "0");
    const expectedStopValue = `${expectedStop.getUTCFullYear()}-${pad(expectedStop.getUTCMonth() + 1)}-${pad(expectedStop.getUTCDate())}T${pad(expectedStop.getUTCHours())}:00`;

    return stopDate === expectedStopValue;
}

function isValidDateOnly(value) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day;
}

async function acquireRentalSlotLock(conn, startDate) {
    const lockName = `rental-slot-${startDate.slice(0, 13).replace(/[-T:]/g, "")}`;
    const result = await conn.query("SELECT GET_LOCK(?, 5) AS acquired", [lockName]);
    return Number(result[0]?.acquired) === 1 ? lockName : null;
}

async function releaseRentalSlotLock(conn, lockName) {
    if (lockName) {
        await conn.query("SELECT RELEASE_LOCK(?)", [lockName]);
    }
}

async function hasConflictingRental(conn, startDate, stopDate, excludeId = null) {
    const rows = await conn.query(`
        SELECT id
        FROM rental_service
        WHERE rental_start_date < ?
          AND rental_stop_date > ?
          AND UPPER(status) NOT IN ('CANCELLED', 'CANCELED', 'ANNULLATA', 'REJECTED')
          AND (? IS NULL OR id <> ?)
        LIMIT 1
    `, [
        `${stopDate.replace("T", " ")}:00`,
        `${startDate.replace("T", " ")}:00`,
        excludeId,
        excludeId
    ]);

    return rows.length > 0;
}

async function acquireProductRentalLock(conn, productId) {
    const lockName = `rental-product-${productId}`;
    const result = await conn.query("SELECT GET_LOCK(?, 5) AS acquired", [lockName]);
    return Number(result[0]?.acquired) === 1 ? lockName : null;
}

async function hasConflictingProductRental(conn, productId, startDate, stopDate, excludeId = null) {
    const rows = await conn.query(`
        SELECT id
        FROM rental_product
        WHERE produc_id = ?
          AND rental_start_date < ?
          AND rental_stop_date > ?
          AND UPPER(status) NOT IN ('CANCELLED', 'CANCELED', 'ANNULLATA', 'REJECTED')
          AND (? IS NULL OR id <> ?)
        LIMIT 1
    `, [productId, stopDate, startDate, excludeId, excludeId]);

    return rows.length > 0;
}

const upload = multer({ storage });

app.use(
    '/uploads',
    express.static(uploadsDirectory)
);

const productStorage = multer.diskStorage({

    destination: function (req, file, cb) {
        const directory = path.join(uploadsDirectory, 'products');
        require('node:fs').mkdir(directory, { recursive: true }, (error) => {
            cb(error, directory);
        });

    },

    filename: function (req, file, cb) {

        const uniqueName =
            Date.now() + '-' + file.originalname;

        cb(null, uniqueName);

    }

});

const serviceStorage = multer.diskStorage({

    destination: function (req, file, cb) {
        const directory = path.join(uploadsDirectory, 'services');
        require('node:fs').mkdir(directory, { recursive: true }, (error) => {
            cb(error, directory);
        });

    },

    filename: function (req, file, cb) {

        const uniqueName =
            Date.now() + '-' + file.originalname;

        cb(null, uniqueName);

    }

});

const uploadProduct = multer({
    storage: productStorage
});
const uploadService = multer({
    storage: serviceStorage
});

app.get(
    "/api/test-auth",
    authenticateToken,
    (req, res) => {

        res.json({
            success: true,
            message: "Valid token",
            user: req.user
        });
    }
);

app.post("/api/login", async (req, res) => {
    //admin
    //Admin123!
    const { username, password } = req.body;

    let conn;

    try {

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "Username and password are required"
            });
        }

        conn = await db.getConnection();

        const rows = await conn.query(`
            SELECT
                id,
                username,
                email,
                password_hash,
                nome,
                cognome,
                role,
                level,
                active
            FROM users
            WHERE username = ?
            LIMIT 1
        `, [username]);

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Incorrect username or password"
            });
        }

        const user = rows[0];

        const passwordCorretta = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordCorretta) {
            return res.status(401).json({
                success: false,
                message: "Incorrect username or password"
            });
        }

        if (!user.active) {
            return res.status(403).json({
                success: false,
                message: "User account is disabled"
            });
        }

        // Aggiorno ultimo accesso
        await conn.query(
            "UPDATE users SET last_login = NOW() WHERE id = ?",
            [user.id]
        );

        const token = jwt.sign(
            {
                id: Number(user.id),
                username: user.username,
                role: user.role,
                level: Number(user.level)
            },
            JWT_SECRET,
            {
                expiresIn: "8h"
            }
        );

        return res.json({
            success: true,
            message: "Login successful",

            token: token,

            user: {
                id: Number(user.id),
                username: user.username,
                email: user.email,
                nome: user.nome,
                cognome: user.cognome,
                role: user.role,
                level: Number(user.level)
            }
        });

    } catch (error) {

        console.error("Login error:", error);

        return res.status(500).json({
            success: false,
            message: "Login failed"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.post("/api/register", async (req, res) => {
    const username = typeof req.body.username === "string"
        ? req.body.username.trim()
        : "";
    const email = typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const nome = typeof req.body.nome === "string"
        ? req.body.nome.trim()
        : "";
    const cognome = typeof req.body.cognome === "string"
        ? req.body.cognome.trim()
        : "";
    const password = typeof req.body.password === "string"
        ? req.body.password
        : "";

    if (
        username.length < 3 ||
        username.length > 50 ||
        nome.length < 1 ||
        nome.length > 100 ||
        cognome.length < 1 ||
        cognome.length > 100 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 150 ||
        password.length < 8 ||
        password.length > 128
    ) {
        return res.status(400).json({
            success: false,
            message: "Enter a valid first name, last name, username, and email address, and a password of at least 8 characters"
        });
    }

    let conn;

    try {
        conn = await db.getConnection();
        const existing = await conn.query(`
            SELECT id
            FROM users
            WHERE username = ? OR LOWER(email) = ?
            LIMIT 1
        `, [username, email]);

        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Username or email is already in use"
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const result = await conn.query(`
            INSERT INTO users
            (
                username,
                email,
                password_hash,
                nome,
                cognome,
                role,
                level,
                active
            )
            VALUES (?, ?, ?, ?, ?, 'user', 10, 1)
        `, [username, email, passwordHash, nome, cognome]);

        return res.status(201).json({
            success: true,
            message: "Registration complete. You can now log in.",
            id: Number(result.insertId)
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                success: false,
                message: "Username or email is already in use"
            });
        }

        console.error("Registration error:", error);
        return res.status(500).json({
            success: false,
            message: "Registration failed"
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
});

app.get("/api/rentals", authenticateToken, async (req, res) => {
    let conn;

    try {
        conn = await db.getConnection();
        const isAdmin = ["admin", "superadmin"].includes(
            String(req.user?.role || "").toLowerCase()
        );

        const rows = await conn.query(`
            SELECT
                rental.id,
                rental.service_id,
                service.name AS service_name,
                rental.user_owner_id,
                owner.nome AS owner_nome,
                owner.cognome AS owner_cognome,
                owner.username AS owner_username,
                rental.rental_number,
                rental.rental_start_date,
                rental.rental_stop_date,
                rental.status,
                rental.notes,
                rental.created_at,
                rental.updated_at
            FROM rental_service AS rental
            LEFT JOIN services AS service
                ON service.id = rental.service_id
            LEFT JOIN users AS owner
                ON owner.id = rental.user_owner_id
            WHERE (? = 1 OR rental.user_owner_id = ?)
            ORDER BY rental.rental_start_date DESC, rental.id DESC
        `, [isAdmin ? 1 : 0, req.user.id]);

        return res.json(rows);
    } catch (error) {
        console.error("Error loading bookings:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to load bookings"
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
});

app.get("/api/rentals/:id", authenticateToken, requireAdmin, async (req, res) => {
    let conn;

    try {
        conn = await db.getConnection();
        const rows = await conn.query(`
            SELECT
                rental.id,
                rental.service_id,
                service.name AS service_name,
                rental.user_owner_id,
                owner.nome AS owner_nome,
                owner.cognome AS owner_cognome,
                owner.username AS owner_username,
                rental.rental_number,
                rental.rental_start_date,
                rental.rental_stop_date,
                rental.status,
                rental.notes,
                rental.created_at,
                rental.updated_at
            FROM rental_service AS rental
            LEFT JOIN services AS service ON service.id = rental.service_id
            LEFT JOIN users AS owner ON owner.id = rental.user_owner_id
            WHERE rental.id = ?
            LIMIT 1
        `, [req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Booking not found"
            });
        }

        return res.json(rows[0]);
    } catch (error) {
        console.error("Error loading booking:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to load the booking"
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
});

app.get("/api/rental-availability", authenticateToken, async (req, res) => {
    const fromDate = typeof req.query.from === "string" ? req.query.from : "";
    const toDate = typeof req.query.to === "string" ? req.query.to : "";
    const excludeId = typeof req.query.excludeId === "string"
        ? Number(req.query.excludeId)
        : null;
    const isAdmin = ["admin", "superadmin"].includes(
        String(req.user?.role || "").toLowerCase()
    );

    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(toDate) ||
        !isValidDateOnly(fromDate) ||
        !isValidDateOnly(toDate) ||
        (req.query.excludeId !== undefined &&
            (!Number.isInteger(excludeId) || excludeId <= 0 || !isAdmin)) ||
        (() => {
            const [year, month, day] = fromDate.split("-").map(Number);
            const expectedTo = new Date(Date.UTC(year, month - 1, day + 7));
            const expectedToValue = `${expectedTo.getUTCFullYear()}-${String(expectedTo.getUTCMonth() + 1).padStart(2, "0")}-${String(expectedTo.getUTCDate()).padStart(2, "0")}`;
            return expectedToValue !== toDate;
        })()
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid calendar range"
        });
    }

    let conn;

    try {
        conn = await db.getConnection();
        const rows = await conn.query(`
            SELECT
                id,
                DATE_FORMAT(rental_start_date, '%Y-%m-%dT%H:%i:%s') AS rental_start_date,
                DATE_FORMAT(rental_stop_date, '%Y-%m-%dT%H:%i:%s') AS rental_stop_date
            FROM rental_service
            WHERE rental_start_date < ?
              AND rental_stop_date > ?
              AND UPPER(status) NOT IN ('CANCELLED', 'CANCELED', 'ANNULLATA', 'REJECTED')
              AND (? IS NULL OR id <> ?)
            ORDER BY rental_start_date
        `, [
            `${toDate} 00:00:00`,
            `${fromDate} 00:00:00`,
            excludeId,
            excludeId
        ]);

        return res.json(rows);
    } catch (error) {
        console.error("Error loading booking availability:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to load booking availability"
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
});

app.get("/api/rental-options", authenticateToken, async (req, res) => {
    let conn;

    try {
        conn = await db.getConnection();
        const isAdmin = ["admin", "superadmin"].includes(
            String(req.user?.role || "").toLowerCase()
        );
        const [services, users] = await Promise.all([
            conn.query(`
                SELECT id, name
                FROM services
                WHERE active = 1
                ORDER BY sort_order, name
            `),
            isAdmin
                ? conn.query(`
                    SELECT id, username, nome, cognome
                    FROM users
                    WHERE active = 1
                    ORDER BY nome, cognome, username
                `)
                : conn.query(`
                    SELECT id, username, nome, cognome
                    FROM users
                    WHERE active = 1 AND id = ?
                    LIMIT 1
                `, [req.user.id])
        ]);

        return res.json({ services, users });
    } catch (error) {
        console.error("Error loading booking options:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to load options"
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
});

app.post("/api/rentals", authenticateToken, async (req, res) => {
    const serviceId = Number(req.body.service_id);
    const startDate = req.body.rental_start_date;
    const stopDate = req.body.rental_stop_date;
    const notes = typeof req.body.notes === "string"
        ? req.body.notes.trim()
        : null;
    const isAdmin = ["admin", "superadmin"].includes(
        String(req.user?.role || "").toLowerCase()
    );
    const ownerId = isAdmin ? Number(req.body.user_owner_id) : Number(req.user?.id);

    if (
        !Number.isInteger(serviceId) ||
        !Number.isInteger(ownerId) ||
        !isValidRentalSlot(startDate, stopDate)
    ) {
        return res.status(400).json({
            success: false,
            message: "Select an available one-hour slot between 08:00 and 19:00"
        });
    }

    let conn;
    let slotLock = null;

    try {
        conn = await db.getConnection();
        const [services, owners] = await Promise.all([
            conn.query("SELECT id FROM services WHERE id = ? AND active = 1 LIMIT 1", [serviceId]),
            conn.query("SELECT id FROM users WHERE id = ? AND active = 1 LIMIT 1", [ownerId])
        ]);

        if (services.length === 0 || owners.length === 0) {
            return res.status(400).json({
                success: false,
                message: "The selected service or owner is inactive"
            });
        }

        slotLock = await acquireRentalSlotLock(conn, startDate);
        if (!slotLock) {
            return res.status(503).json({
                success: false,
                message: "Booking slot is temporarily locked. Please try again."
            });
        }

        if (await hasConflictingRental(conn, startDate, stopDate)) {
            return res.status(409).json({
                success: false,
                message: "This time slot was just booked. Select another slot."
            });
        }

        for (let attempt = 0; attempt < 5; attempt++) {
            const rentalNumber = await nextRentalNumber(conn);

            if (!rentalNumber) {
                return res.status(409).json({
                    success: false,
                    message: "The daily booking number limit has been reached"
                });
            }

            try {
                const result = await conn.query(`
                    INSERT INTO rental_service
                    (
                        service_id,
                        user_owner_id,
                        rental_number,
                        rental_start_date,
                        rental_stop_date,
                        status,
                        notes
                    )
                    VALUES (?, ?, ?, ?, ?, 'DRAFT', ?)
                `, [
                    serviceId,
                    ownerId,
                    rentalNumber,
                    `${startDate.replace("T", " ")}:00`,
                    `${stopDate.replace("T", " ")}:00`,
                    notes || null
                ]);

                return res.status(201).json({
                    success: true,
                    id: Number(result.insertId),
                    rental_number: rentalNumber,
                    message: "Booking created successfully"
                });
            } catch (error) {
                if (error.code !== "ER_DUP_ENTRY") {
                    throw error;
                }
            }
        }

        return res.status(409).json({
            success: false,
            message: "Could not generate a unique booking number. Please try again."
        });
    } catch (error) {
        console.error("Error creating booking:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create the booking"
        });
    } finally {
        if (conn) {
            try {
                await releaseRentalSlotLock(conn, slotLock);
            } catch (error) {
                console.error("Error releasing booking slot lock:", error);
            }
            conn.release();
        }
    }
});

app.put("/api/rentals/:id", authenticateToken, requireAdmin, async (req, res) => {
    const rentalNumber = typeof req.body.rental_number === "string"
        ? req.body.rental_number.trim()
        : "";
    const serviceId = Number(req.body.service_id);
    const ownerId = Number(req.body.user_owner_id);
    const startDate = req.body.rental_start_date;
    const stopDate = req.body.rental_stop_date;
    const status = typeof req.body.status === "string"
        ? req.body.status.trim()
        : "";
    const notes = typeof req.body.notes === "string"
        ? req.body.notes.trim()
        : null;

    if (
        !rentalNumber ||
        rentalNumber.length > 30 ||
        !Number.isInteger(serviceId) ||
        !Number.isInteger(ownerId) ||
        !isValidRentalSlot(startDate, stopDate) ||
        !status ||
        status.length > 30
    ) {
        return res.status(400).json({
            success: false,
            message: "Check the booking number, service, owner, time slot, and status"
        });
    }

    let conn;
    let slotLock = null;

    try {
        conn = await db.getConnection();
        const [rentals, services, owners] = await Promise.all([
            conn.query("SELECT id FROM rental_service WHERE id = ? LIMIT 1", [req.params.id]),
            conn.query("SELECT id FROM services WHERE id = ? LIMIT 1", [serviceId]),
            conn.query("SELECT id FROM users WHERE id = ? LIMIT 1", [ownerId])
        ]);

        if (rentals.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Booking not found"
            });
        }

        if (services.length === 0 || owners.length === 0) {
            return res.status(400).json({
                success: false,
                message: "The selected service or owner does not exist"
            });
        }

        slotLock = await acquireRentalSlotLock(conn, startDate);
        if (!slotLock) {
            return res.status(503).json({
                success: false,
                message: "Booking slot is temporarily locked. Please try again."
            });
        }

        if (await hasConflictingRental(conn, startDate, stopDate, req.params.id)) {
            return res.status(409).json({
                success: false,
                message: "This time slot is already occupied by another booking"
            });
        }

        await conn.query(`
            UPDATE rental_service
            SET
                service_id = ?,
                user_owner_id = ?,
                rental_number = ?,
                rental_start_date = ?,
                rental_stop_date = ?,
                status = ?,
                notes = ?
            WHERE id = ?
        `, [
            serviceId,
            ownerId,
            rentalNumber,
            `${startDate.replace("T", " ")}:00`,
            `${stopDate.replace("T", " ")}:00`,
            status,
            notes || null,
            req.params.id
        ]);

        return res.json({
            success: true,
            message: "Booking updated successfully"
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                success: false,
                message: "Booking number is already in use"
            });
        }

        console.error("Error updating booking:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update the booking"
        });
    } finally {
        if (conn) {
            try {
                await releaseRentalSlotLock(conn, slotLock);
            } catch (error) {
                console.error("Error releasing booking slot lock:", error);
            }
            conn.release();
        }
    }
});

app.delete("/api/rentals/:id", authenticateToken, requireAdmin, async (req, res) => {
    let conn;

    try {
        conn = await db.getConnection();
        const result = await conn.query(
            "DELETE FROM rental_service WHERE id = ?",
            [req.params.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Booking not found"
            });
        }

        return res.json({
            success: true,
            message: "Booking deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting booking:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to delete the booking"
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
});

app.post("/api/rentals/:id/copy", authenticateToken, requireAdmin, async (req, res) => {
    let conn;

    try {
        conn = await db.getConnection();
        const rentals = await conn.query(`
            SELECT
                service_id,
                user_owner_id,
                DATE_FORMAT(rental_start_date, '%Y-%m-%dT%H:%i') AS rental_start_date,
                DATE_FORMAT(rental_stop_date, '%Y-%m-%dT%H:%i') AS rental_stop_date,
                status,
                notes
            FROM rental_service
            WHERE id = ?
            LIMIT 1
        `, [req.params.id]);

        if (rentals.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Booking not found"
            });
        }

        const original = rentals[0];
        const startDate = original.rental_start_date;
        const stopDate = original.rental_stop_date;
        const slotLock = await acquireRentalSlotLock(conn, startDate);

        if (!slotLock) {
            return res.status(503).json({
                success: false,
                message: "Booking slot is temporarily locked. Please try again."
            });
        }

        try {
            if (await hasConflictingRental(conn, startDate, stopDate)) {
                return res.status(409).json({
                    success: false,
                    message: "To duplicate this booking, create a new booking and select an available slot"
                });
            }

            for (let attempt = 0; attempt < 5; attempt++) {
                const rentalNumber = await nextRentalNumber(conn);

                if (!rentalNumber) {
                    return res.status(409).json({
                        success: false,
                        message: "The daily booking number limit has been reached"
                    });
                }

                try {
                    const result = await conn.query(`
                        INSERT INTO rental_service
                        (
                            service_id,
                            user_owner_id,
                            rental_number,
                            rental_start_date,
                            rental_stop_date,
                            status,
                            notes
                        )
                        VALUES (?, ?, ?, ?, ?, 'DRAFT', ?)
                    `, [
                        original.service_id,
                        original.user_owner_id,
                        rentalNumber,
                        `${startDate.replace("T", " ")}:00`,
                        `${stopDate.replace("T", " ")}:00`,
                        original.notes
                    ]);

                    return res.status(201).json({
                        success: true,
                        id: Number(result.insertId),
                        rental_number: rentalNumber,
                        message: "Booking duplicated successfully"
                    });
                } catch (error) {
                    if (error.code !== "ER_DUP_ENTRY") {
                        throw error;
                    }
                }
            }

            return res.status(409).json({
                success: false,
                message: "Could not generate a unique booking number. Please try again."
            });
        } finally {
            await releaseRentalSlotLock(conn, slotLock);
        }
    } catch (error) {
        console.error("Error duplicating booking:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to duplicate the booking"
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
});

app.get("/api/rental-products", authenticateToken, async (req, res) => {
    let conn;

    try {
        conn = await db.getConnection();
        const isAdmin = ["admin", "superadmin"].includes(
            String(req.user?.role || "").toLowerCase()
        );
        const rows = await conn.query(`
            SELECT
                rental.id,
                rental.produc_id AS product_id,
                product.nome AS product_name,
                rental.user_owner_id,
                owner.nome AS owner_nome,
                owner.cognome AS owner_cognome,
                owner.username AS owner_username,
                rental.rental_number,
                DATE_FORMAT(rental.rental_start_date, '%Y-%m-%d') AS rental_start_date,
                DATE_FORMAT(rental.rental_stop_date, '%Y-%m-%d') AS rental_stop_date,
                rental.status,
                rental.notes,
                rental.created_at,
                rental.updated_at
            FROM rental_product AS rental
            LEFT JOIN products AS product
                ON product.id = rental.produc_id
            LEFT JOIN users AS owner
                ON owner.id = rental.user_owner_id
            WHERE (? = 1 OR rental.user_owner_id = ?)
            ORDER BY rental.rental_start_date DESC, rental.id DESC
        `, [isAdmin ? 1 : 0, req.user.id]);

        return res.json(rows);
    } catch (error) {
        console.error("Error loading product bookings:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to load product bookings"
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
});

app.get("/api/rental-products/:id", authenticateToken, requireAdmin, async (req, res) => {
    let conn;

    try {
        conn = await db.getConnection();
        const rows = await conn.query(`
            SELECT
                rental.id,
                rental.produc_id AS product_id,
                product.nome AS product_name,
                rental.user_owner_id,
                owner.nome AS owner_nome,
                owner.cognome AS owner_cognome,
                owner.username AS owner_username,
                rental.rental_number,
                DATE_FORMAT(rental.rental_start_date, '%Y-%m-%d') AS rental_start_date,
                DATE_FORMAT(rental.rental_stop_date, '%Y-%m-%d') AS rental_stop_date,
                rental.status,
                rental.notes,
                rental.created_at,
                rental.updated_at
            FROM rental_product AS rental
            LEFT JOIN products AS product ON product.id = rental.produc_id
            LEFT JOIN users AS owner ON owner.id = rental.user_owner_id
            WHERE rental.id = ?
            LIMIT 1
        `, [req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Product booking not found"
            });
        }

        return res.json(rows[0]);
    } catch (error) {
        console.error("Error loading product booking:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to load the product booking"
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
});

app.get("/api/rental-product-options", authenticateToken, async (req, res) => {
    let conn;

    try {
        conn = await db.getConnection();
        const isAdmin = ["admin", "superadmin"].includes(
            String(req.user?.role || "").toLowerCase()
        );
        const [products, users] = await Promise.all([
            conn.query(`
                SELECT id, codice, nome
                FROM products
                WHERE active = 1
                ORDER BY nome, codice
            `),
            isAdmin
                ? conn.query(`
                    SELECT id, username, nome, cognome
                    FROM users
                    WHERE active = 1
                    ORDER BY nome, cognome, username
                `)
                : conn.query(`
                    SELECT id, username, nome, cognome
                    FROM users
                    WHERE active = 1 AND id = ?
                    LIMIT 1
                `, [req.user.id])
        ]);

        return res.json({ products, users });
    } catch (error) {
        console.error("Error loading product booking options:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to load product booking options"
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
});

app.get("/api/rental-product-availability", authenticateToken, async (req, res) => {
    const productId = typeof req.query.productId === "string"
        ? Number(req.query.productId)
        : NaN;
    const startDate = typeof req.query.from === "string" ? req.query.from : "";
    const stopDate = typeof req.query.to === "string" ? req.query.to : "";
    const excludeId = typeof req.query.excludeId === "string"
        ? Number(req.query.excludeId)
        : null;
    const isAdmin = ["admin", "superadmin"].includes(
        String(req.user?.role || "").toLowerCase()
    );

    if (
        !Number.isInteger(productId) ||
        productId <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(stopDate) ||
        !isValidDateOnly(startDate) ||
        !isValidDateOnly(stopDate) ||
        startDate >= stopDate ||
        (req.query.excludeId !== undefined &&
            (!Number.isInteger(excludeId) || excludeId <= 0 || !isAdmin))
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid date range or product"
        });
    }

    let conn;

    try {
        conn = await db.getConnection();
        const products = await conn.query(
            "SELECT id FROM products WHERE id = ? AND active = 1 LIMIT 1",
            [productId]
        );
        if (products.length === 0) {
            return res.status(400).json({
                success: false,
                message: "The selected product is inactive"
            });
        }

        const unavailable = await hasConflictingProductRental(
            conn,
            productId,
            startDate,
            stopDate,
            excludeId
        );

        return res.json({ available: !unavailable });
    } catch (error) {
        console.error("Error loading product availability:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to check product availability"
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
});

app.post("/api/rental-products", authenticateToken, async (req, res) => {
    const productId = Number(req.body.product_id);
    const startDate = req.body.rental_start_date;
    const stopDate = req.body.rental_stop_date;
    const notes = typeof req.body.notes === "string"
        ? req.body.notes.trim()
        : null;
    const isAdmin = ["admin", "superadmin"].includes(
        String(req.user?.role || "").toLowerCase()
    );
    const ownerId = isAdmin ? Number(req.body.user_owner_id) : Number(req.user?.id);

    if (
        !Number.isInteger(productId) ||
        productId <= 0 ||
        !Number.isInteger(ownerId) ||
        ownerId <= 0 ||
        typeof startDate !== "string" ||
        typeof stopDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(stopDate) ||
        !isValidDateOnly(startDate) ||
        !isValidDateOnly(stopDate) ||
        startDate >= stopDate
    ) {
        return res.status(400).json({
            success: false,
            message: "Select a product and a valid date range"
        });
    }

    let conn;
    let productLock = null;

    try {
        conn = await db.getConnection();
        const [products, owners] = await Promise.all([
            conn.query("SELECT id FROM products WHERE id = ? AND active = 1 LIMIT 1", [productId]),
            conn.query("SELECT id FROM users WHERE id = ? AND active = 1 LIMIT 1", [ownerId])
        ]);

        if (products.length === 0 || owners.length === 0) {
            return res.status(400).json({
                success: false,
                message: "The selected product or owner is inactive"
            });
        }

        productLock = await acquireProductRentalLock(conn, productId);
        if (!productLock) {
            return res.status(503).json({
                success: false,
                message: "Product booking is temporarily locked. Please try again."
            });
        }

        if (await hasConflictingProductRental(conn, productId, startDate, stopDate)) {
            return res.status(409).json({
                success: false,
                message: "The product is unavailable for the selected dates"
            });
        }

        for (let attempt = 0; attempt < 5; attempt++) {
            const rentalNumber = await nextProductRentalNumber(conn);

            if (!rentalNumber) {
                return res.status(409).json({
                    success: false,
                    message: "The daily product booking number limit has been reached"
                });
            }

            try {
                const result = await conn.query(`
                    INSERT INTO rental_product
                    (
                        produc_id,
                        user_owner_id,
                        rental_number,
                        rental_start_date,
                        rental_stop_date,
                        status,
                        notes
                    )
                    VALUES (?, ?, ?, ?, ?, 'DRAFT', ?)
                `, [productId, ownerId, rentalNumber, startDate, stopDate, notes || null]);

                return res.status(201).json({
                    success: true,
                    id: Number(result.insertId),
                    rental_number: rentalNumber,
                    message: "Product booking created successfully"
                });
            } catch (error) {
                if (error.code !== "ER_DUP_ENTRY") {
                    throw error;
                }
            }
        }

        return res.status(409).json({
            success: false,
            message: "Could not generate a unique product booking number. Please try again."
        });
    } catch (error) {
        console.error("Error creating product booking:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create the product booking"
        });
    } finally {
        if (conn) {
            try {
                await releaseRentalSlotLock(conn, productLock);
            } catch (error) {
                console.error("Error releasing product booking lock:", error);
            }
            conn.release();
        }
    }
});

app.put("/api/rental-products/:id", authenticateToken, requireAdmin, async (req, res) => {
    const rentalNumber = typeof req.body.rental_number === "string"
        ? req.body.rental_number.trim()
        : "";
    const productId = Number(req.body.product_id);
    const ownerId = Number(req.body.user_owner_id);
    const startDate = req.body.rental_start_date;
    const stopDate = req.body.rental_stop_date;
    const status = typeof req.body.status === "string"
        ? req.body.status.trim()
        : "";
    const notes = typeof req.body.notes === "string"
        ? req.body.notes.trim()
        : null;

    if (
        !rentalNumber ||
        rentalNumber.length > 30 ||
        !Number.isInteger(productId) ||
        productId <= 0 ||
        !Number.isInteger(ownerId) ||
        ownerId <= 0 ||
        typeof startDate !== "string" ||
        typeof stopDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(stopDate) ||
        !isValidDateOnly(startDate) ||
        !isValidDateOnly(stopDate) ||
        startDate >= stopDate ||
        !status ||
        status.length > 30
    ) {
        return res.status(400).json({
            success: false,
            message: "Check the booking number, product, owner, dates, and status"
        });
    }

    let conn;
    let productLock = null;

    try {
        conn = await db.getConnection();
        const [rentals, products, owners] = await Promise.all([
            conn.query("SELECT id FROM rental_product WHERE id = ? LIMIT 1", [req.params.id]),
            conn.query("SELECT id FROM products WHERE id = ? LIMIT 1", [productId]),
            conn.query("SELECT id FROM users WHERE id = ? LIMIT 1", [ownerId])
        ]);

        if (rentals.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Product booking not found"
            });
        }

        if (products.length === 0 || owners.length === 0) {
            return res.status(400).json({
                success: false,
                message: "The selected product or owner does not exist"
            });
        }

        productLock = await acquireProductRentalLock(conn, productId);
        if (!productLock) {
            return res.status(503).json({
                success: false,
                message: "Product booking is temporarily locked. Please try again."
            });
        }

        if (await hasConflictingProductRental(conn, productId, startDate, stopDate, req.params.id)) {
            return res.status(409).json({
                success: false,
                message: "The product is already booked for the selected dates"
            });
        }

        await conn.query(`
            UPDATE rental_product
            SET
                produc_id = ?,
                user_owner_id = ?,
                rental_number = ?,
                rental_start_date = ?,
                rental_stop_date = ?,
                status = ?,
                notes = ?
            WHERE id = ?
        `, [
            productId,
            ownerId,
            rentalNumber,
            startDate,
            stopDate,
            status,
            notes || null,
            req.params.id
        ]);

        return res.json({
            success: true,
            message: "Product booking updated successfully"
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                success: false,
                message: "Booking number is already in use"
            });
        }

        console.error("Error updating product booking:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update the product booking"
        });
    } finally {
        if (conn) {
            try {
                await releaseRentalSlotLock(conn, productLock);
            } catch (error) {
                console.error("Error releasing product booking lock:", error);
            }
            conn.release();
        }
    }
});

app.delete("/api/rental-products/:id", authenticateToken, requireAdmin, async (req, res) => {
    let conn;

    try {
        conn = await db.getConnection();
        const result = await conn.query(
            "DELETE FROM rental_product WHERE id = ?",
            [req.params.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Product booking not found"
            });
        }

        return res.json({
            success: true,
            message: "Product booking deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting product booking:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to delete the product booking"
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
});

app.get("/api/dashboard", authenticateToken, async (req, res) => {

    let conn;

    try {

        conn = await db.getConnection();
        const isAdmin = ["admin", "superadmin"].includes(
            String(req.user?.role || "").toLowerCase()
        );

/*         
        const invoiceOwnerFilter = isAdmin
            ? ""
            : " AND user_owner_id = ?";
        const invoiceOwnerParams = isAdmin
            ? []
            : [req.user.id];

        const clientsResult = await conn.query(`
            SELECT COUNT(*) AS totale
            FROM clients
        `);

        const productsResult = await conn.query(`
            SELECT COUNT(*) AS totale
            FROM products
        `);
 */
        const usersResult = await conn.query(`
            SELECT COUNT(*) AS totale
            FROM users
        `);
/* 
        const activeProductsResult = await conn.query(`
            SELECT COUNT(*) AS totale
            FROM products
            WHERE active = 1
        `);

        const inactiveProductsResult = await conn.query(`
            SELECT COUNT(*) AS totale
            FROM products
            WHERE active = 0
        `);
 */
        const activeUsersResult = await conn.query(`
            SELECT COUNT(*) AS totale
            FROM users
            WHERE active = 1
        `);

        const inactiveUsersResult = await conn.query(`
            SELECT COUNT(*) AS totale
            FROM users
            WHERE active = 0
        `);
/* 
        const lowStockResult = await conn.query(`
            SELECT COUNT(*) AS totale
            FROM products
            WHERE quantita <= scorta_minima
              AND active = 1
        `);

        const monthlyInvoices = await conn.query(`
            SELECT
                DATE_FORMAT(invoice_date, '%Y-%m-01') AS month,
                COUNT(*) AS invoice_count,
                SUM(total_amount) AS revenue
            FROM invoices
            WHERE invoice_date >= DATE_FORMAT(
                    DATE_SUB(CURDATE(), INTERVAL 5 MONTH),
                    '%Y-%m-01'
                )
              AND invoice_date < DATE_ADD(
                    DATE_FORMAT(CURDATE(), '%Y-%m-01'),
                    INTERVAL 1 MONTH
                )
              AND status <> 'CANCELLED'
              ${invoiceOwnerFilter}
            GROUP BY DATE_FORMAT(invoice_date, '%Y-%m')
            ORDER BY month
        `, invoiceOwnerParams);

        const invoiceStatuses = await conn.query(`
            SELECT status, COUNT(*) AS invoice_count
            FROM invoices
            WHERE 1 = 1
              ${invoiceOwnerFilter}
            GROUP BY status
            ORDER BY status
        `, invoiceOwnerParams);

        const topProducts = await conn.query(`
            SELECT
                ii.product_id,
                ii.description AS name,
                SUM(ii.quantity) AS quantity
            FROM invoice_items ii
            INNER JOIN invoices i
                ON i.id = ii.invoice_id
            WHERE ii.product_id IS NOT NULL
              AND i.status IN ('ISSUED', 'PAID')
              ${isAdmin ? "" : "AND i.user_owner_id = ?"}
            GROUP BY ii.product_id, ii.description
            ORDER BY quantity DESC, name
            LIMIT 5
        `, invoiceOwnerParams);

        const topClients = await conn.query(`
            SELECT
                c.id,
                c.ragione_sociale AS name,
                SUM(i.total_amount) AS revenue
            FROM invoices i
            INNER JOIN clients c
                ON c.id = i.client_id
            WHERE i.status IN ('ISSUED', 'PAID')
              ${isAdmin ? "" : "AND i.user_owner_id = ?"}
            GROUP BY c.id, c.ragione_sociale
            ORDER BY revenue DESC, name
            LIMIT 5
        `, invoiceOwnerParams);
 */
        return res.json({
/* 
            clients: Number(clientsResult[0].totale),

            products: Number(productsResult[0].totale),

            users: Number(usersResult[0].totale),

            activeProducts:
                Number(activeProductsResult[0].totale),

            inactiveProducts:
                Number(inactiveProductsResult[0].totale),
 */
            activeUsers:
                Number(activeUsersResult[0].totale),

            inactiveUsers:
                Number(inactiveUsersResult[0].totale),
/* 
            lowStock:
                Number(lowStockResult[0].totale),

            charts: {
                monthlyInvoices: monthlyInvoices.map(row => ({
                    month: row.month,
                    count: Number(row.invoice_count),
                    revenue: Number(row.revenue || 0)
                })),
                invoiceStatuses: invoiceStatuses.map(row => ({
                    status: row.status,
                    count: Number(row.invoice_count)
                })),
                topProducts: topProducts.map(row => ({
                    id: Number(row.product_id),
                    name: row.name,
                    quantity: Number(row.quantity)
                })),
                topClients: topClients.map(row => ({
                    id: Number(row.id),
                    name: row.name,
                    revenue: Number(row.revenue)
                }))
            }
 */
        });

    } catch (error) {

        console.error(
            "Dashboard error:",
            error
        );

        return res.status(500).json({
            message:
                "Failed to load the dashboard"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

//app.get("/api/users", async (req, res) => {
app.get("/api/users", authenticateToken, requireAdmin, async (req, res) => {
    let conn;

    try {

        conn = await db.getConnection();

        const rows = await conn.query(`
            SELECT
                id,
                username,
                email,
                nome,
                cognome,
                role,
                level,
                active,
                last_login,
                created_at
            FROM users
            ORDER BY username
        `);

        res.json(rows);

    } catch (error) {

        console.error("Error loading users:", error);

        res.status(500).json({
            message: "Failed to load users"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.get("/api/users/:id", authenticateToken, requireAdmin, async (req, res) => {

    const id = req.params.id;
    let conn;

    try {

        conn = await db.getConnection();

        const rows = await conn.query(`
            SELECT
                id,
                username,
                email,
                nome,
                cognome,
                role,
                level,
                active,
                last_login,
                created_at
            FROM users
            WHERE id = ?
            LIMIT 1
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        return res.json(rows[0]);

    } catch (error) {

        console.error("Error loading user:", error);

        return res.status(500).json({
            message: "Failed to load the user"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.post("/api/users", authenticateToken, requireAdmin, async (req, res) => {

    const {
        username,
        email,
        nome,
        cognome,
        role,
        level,
        active,
        password
    } = req.body;

    let conn;

    try {

        // Controlli minimi
        if (!username || !email || !password) {
            return res.status(400).json({
                message: "Username, email, and password are required"
            });
        }

        conn = await db.getConnection();

        // Controllo username/email già esistenti
        const existing = await conn.query(`
            SELECT id
            FROM users
            WHERE username = ?
               OR email = ?
            LIMIT 1
        `, [
            username,
            email
        ]);

        if (existing.length > 0) {
            return res.status(409).json({
                message: "Username or email is already in use"
            });
        }

        // Cripto la password
        const passwordHash = await bcrypt.hash(
            password,
            10
        );

        // Inserisco l'utente
        const result = await conn.query(`
            INSERT INTO users
            (
                username,
                email,
                password_hash,
                nome,
                cognome,
                role,
                level,
                active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            username,
            email,
            passwordHash,
            nome || null,
            cognome || null,
            role || "user",
            Number(level) || 10,
            active === 0 ? 0 : 1
        ]);

        return res.status(201).json({
            message: "User created successfully",
            id: Number(result.insertId)
        });

    } catch (error) {

        console.error("Error creating user:", error);

        return res.status(500).json({
            message: "Failed to create the user"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.put("/api/users/:id", authenticateToken, requireAdmin, async (req, res) => {

    const id = req.params.id;

    const {
        username,
        email,
        nome,
        cognome,
        role,
        level,
        active,
        password
    } = req.body;

    let conn;

    try {

        if (!username || !email) {
            return res.status(400).json({
                message: "Username and email are required"
            });
        }

        conn = await db.getConnection();

        // Controllo che l'utente esista
        const users = await conn.query(`
            SELECT id
            FROM users
            WHERE id = ?
            LIMIT 1
        `, [id]);

        if (users.length === 0) {
            return res.status(404).json({
                message: "User not found"
            });
        }


        // Controllo che username/email non siano
        // utilizzati da UN ALTRO utente
        const existing = await conn.query(`
            SELECT id
            FROM users
            WHERE (username = ? OR email = ?)
              AND id <> ?
            LIMIT 1
        `, [
            username,
            email,
            id
        ]);

        if (existing.length > 0) {
            return res.status(409).json({
                message: "Username or email is already in use"
            });
        }


        // Aggiorno i dati principali
        await conn.query(`
            UPDATE users
            SET
                username = ?,
                email = ?,
                nome = ?,
                cognome = ?,
                role = ?,
                level = ?,
                active = ?
            WHERE id = ?
        `, [
            username,
            email,
            nome || null,
            cognome || null,
            role || "user",
            Number(level) || 10,
            active === 0 ? 0 : 1,
            id
        ]);


        // Se è stata inserita una nuova password,
        // aggiorno anche la password
        if (password && password.trim() !== "") {

            const passwordHash = await bcrypt.hash(
                password,
                10
            );

            await conn.query(`
                UPDATE users
                SET password_hash = ?
                WHERE id = ?
            `, [
                passwordHash,
                id
            ]);
        }


        return res.json({
            message: "User updated successfully"
        });

    } catch (error) {

        console.error("Error updating user:", error);

        return res.status(500).json({
            message: "Failed to update the user"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.delete("/api/users/:id", authenticateToken, requireAdmin, async (req, res) => {

    const id = req.params.id;
    let conn;

    try {

        conn = await db.getConnection();

        const rows = await conn.query(`
            SELECT
                id,
                username
            FROM users
            WHERE id = ?
            LIMIT 1
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        await conn.query(`
            DELETE FROM users
            WHERE id = ?
        `, [id]);

        return res.json({
            message: "User deleted successfully"
        });

    } catch (error) {

        console.error(
            "Error deleting user:",
            error
        );

        return res.status(500).json({
            message:
                "Failed to delete the user"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.post("/api/users/:id/copy", authenticateToken, requireAdmin, async (req, res) => {

    const id = req.params.id;
    let conn;

    try {

        conn = await db.getConnection();

        // Recupero utente originale
        const rows = await conn.query(`
            SELECT
                id,
                username,
                email,
                nome,
                cognome,
                role,
                level,
                active
            FROM users
            WHERE id = ?
            LIMIT 1
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        const original = rows[0];

        /*
         * Creiamo valori temporaneamente unici.
         * Dopo l'inserimento useremo l'ID per renderli
         * ancora più chiari.
         */
        const unique = Date.now();

        const temporaryUsername =
            `${original.username}_copy_${unique}`;

        const temporaryEmail =
            `copy_${unique}_${original.email}`;

        // Password temporanea
        const temporaryPassword = "ChangeMe123!";

        const passwordHash = await bcrypt.hash(
            temporaryPassword,
            10
        );

        // Inserimento copia
        const result = await conn.query(`
            INSERT INTO users
            (
                username,
                email,
                password_hash,
                nome,
                cognome,
                role,
                level,
                active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            temporaryUsername,
            temporaryEmail,
            passwordHash,
            original.nome,
            original.cognome,
            original.role,
            original.level,
            original.active
        ]);

        const newId = Number(result.insertId);

        // Username più leggibile
        const newUsername =
            `${original.username}_copy_${newId}`;

        await conn.query(`
            UPDATE users
            SET username = ?
            WHERE id = ?
        `, [
            newUsername,
            newId
        ]);

        return res.status(201).json({
            message: "User duplicated successfully",
            id: newId,
            username: newUsername,
            temporaryPassword
        });

    } catch (error) {

        console.error(
            "Error duplicating user:",
            error
        );

        return res.status(500).json({
            message:
                "Failed to duplicate the user"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.get("/api/services", authenticateToken, async (req, res) => {

    let conn;

    try {

        conn = await db.getConnection();

        const rows = await conn.query(`
            SELECT
                s.id,
                s.codice,
                s.name,
                s.time_type,
                s.time_unit,
                s.description,
                s.price,
                s.immagine,
                s.active,
                s.sort_order
            FROM services s
            ORDER BY id DESC
        `);
        console.log("Services loaded:", rows.length);
        return res.json(rows);

    } catch (error) {

        console.error("Error loading services:", error);

        return res.status(500).json({
            message: "Failed to load services"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});


app.put("/api/services/:id", authenticateToken,async (req, res) => {

    const id = req.params.id;

    const {
        name,
        description,
        time_type,
        time_unit,
        sort_order,
        price,
        immagine,
        active
    } = req.body;

    let conn;

    try {

        if (typeof name !== "string" || !name.trim()) {
            return res.status(400).json({
                message: "Service name is required"
            });
        }

        conn = await db.getConnection();

        const rows = await conn.query(`
            SELECT id
            FROM services
            WHERE id = ?
            LIMIT 1
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: "Service not found"
            });
        }

        await conn.query(`
            UPDATE services
            SET
                name = ?,
                description = ?,
                time_type = ?,
                time_unit = ?,
                sort_order = ?,
                price = ?,
                immagine = ?,
                active = ?
            WHERE id = ?
        `, [
            name.trim(),
            description || null,
            time_type ?? 0,
            time_unit ?? 0,
            sort_order ?? 100,
            price ?? 0,
            immagine || null,
            Number(active) === 0 ? 0 : 1,
            id
        ]);

        return res.json({
            message: "Service updated successfully"
        });

    } catch (error) {

        console.error("Error updating service:", error);

        return res.status(500).json({
            message: "Failed to update the service"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});


app.get("/api/services/:id",authenticateToken, async (req, res) => {

    const id = req.params.id;
    let conn;

    try {

        conn = await db.getConnection();

        const rows = await conn.query(`
            SELECT
                s.id,
                s.codice,
                s.name,
                s.description,
                s.time_type,
                s.time_unit,
                s.price,
                s.immagine,
                s.active,
                sort_order
            FROM services s
            WHERE s.id = ?
            LIMIT 1
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: "Service not found"
            });
        }

        return res.json(rows[0]);

    } catch (error) {

        console.error("Error loading service:", error);

        return res.status(500).json({
            message: "Failed to load the service"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.post("/api/services", authenticateToken, async (req, res) => {

    const {
        codice,
        name,
        description,
        immagine,
        time_type,
        time_unit,
        sort_order,
        price,
        active
    } = req.body;

    let conn;

    try {

        if (!name) {
            return res.status(400).json({
                message: "Service name is required"
            });
        }

        conn = await db.getConnection();

        /*
         * Codice temporaneo univoco.
         * Ci serve perché codice è NOT NULL e UNIQUE,
         * ma non conosciamo ancora l'ID AUTO_INCREMENT.
         */
        const codiceProvvisorio =
            `TMP-${Date.now()}`;

        const result = await conn.query(`
            INSERT INTO services
            (
            codice,
            name,
            description,
            time_type,
            time_unit,
            sort_order,
            price,
            immagine,
            active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            codiceProvvisorio,
            name,
            description || null,
            time_type || 0,
            time_unit || 0,
            sort_order || 100,
            price || 0,
            immagine || null,
            Number(active) === 0 ? 0 : 1
        ]);

        /*
         * ID generato da MariaDB
         */
        const newId = Number(result.insertId);


        /*
         * Creo il codice prodotto
         *
         * 1   -> SVR001
         * 12  -> SVR012
         * 123 -> SVR123
         */
        const nuovoCodice =
            "SVR" + String(newId).padStart(3, "0");


        /*
         * Controllo che non esista già
         */
        const existing = await conn.query(`
            SELECT id
            FROM services
            WHERE codice = ?
              AND id <> ?
            LIMIT 1
        `, [
            nuovoCodice,
            newId
        ]);

        if (existing.length > 0) {

            // Elimino il record appena inserito
            await conn.query(
                "DELETE FROM services WHERE id = ?",
                [newId]
            );

            return res.status(409).json({
                message:
                    `Service code ${nuovoCodice} already exists`
            });
        }


        /*
         * Sostituisco il codice temporaneo
         * con quello definitivo.
         */
        await conn.query(`
            UPDATE services
            SET codice = ?
            WHERE id = ?
        `, [
            nuovoCodice,
            newId
        ]);



        return res.status(201).json({

            message:
                "Service created successfully",

            id: newId
        });


    } catch (error) {

        console.error(
            "Error creating product:",
            error
        );

        return res.status(500).json({
            message:
                "Failed to create the product"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.post("/api/services/:id/copy", authenticateToken, requireAdmin, async (req, res) => {

    const id = req.params.id;
    let conn;

    try {

        conn = await db.getConnection();

        // Recupero service originale
        const rows = await conn.query(`
            SELECT
                id,
                name,
                description,
                time_type,
                time_unit,
                price,
                immagine,
                active,
                sort_order
            FROM services   
            WHERE id = ?
            LIMIT 1
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: "Service not found"
            });
        }

        const original = rows[0];

        // Inserimento copia
        const result = await conn.query(`
            INSERT INTO services
            (
                name,
                description,
                time_type,
                time_unit,
                sort_order,
                price,
                immagine,
                active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            original.name + " (Copy)",
            original.description || null,
            original.time_type || 0,
            original.time_unit || 0,
            original.sort_order || 100,
            original.price || 0,
            original.immagine || null,
            original.active
        ]);

        const newId = Number(result.insertId);

        return res.status(201).json({
            message: "Service duplicated successfully",
            id: newId
        });

    } catch (error) {

        console.error(
            "Error duplicating service:",
            error
        );

        return res.status(500).json({
            message:
                "Failed to duplicate the service"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.delete("/api/services/:id",authenticateToken, requireAdmin, async (req, res) => {

    const id = req.params.id;
    let conn;

    try {

        conn = await db.getConnection();

        // Controllo che il prodotto esista
        const rows = await conn.query(`
            SELECT id, name
            FROM services
            WHERE id = ?
            LIMIT 1
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: "Service not found"
            });
        }

        await conn.query(`
            DELETE FROM services
            WHERE id = ?
        `, [id]);

        return res.json({
            message: "Service deleted successfully"
        });

    } catch (error) {

        console.error(
            "Error deleting service:",
            error
        );

        return res.status(500).json({
            message:
                "Failed to delete the service"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.post("/api/services/upload", authenticateToken,
    uploadService.single("image"),
    (req, res) => {

        if (!req.file) {
            return res.status(400).json({
                message: "No image received"
            });
        }

        return res.json({
            path: `/uploads/services/${req.file.filename}`
        });
    }
);


app.put("/api/products/:id", authenticateToken,async (req, res) => {

    const id = req.params.id;

    const {
        nome,
        codice,
        descrizione,
        immagine,
        active
    } = req.body;

    let conn;

    try {

        if (!nome) {
            return res.status(400).json({
                message: "Product name is required"
            });
        }

        conn = await db.getConnection();

        const rows = await conn.query(`
            SELECT id
            FROM products
            WHERE id = ?
            LIMIT 1
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        await conn.query(`
            UPDATE products
            SET
                nome = ?,
                codice = ?,
                descrizione = ?,
                immagine = ?,
                active = ?
            WHERE id = ?
        `, [
            nome,
            codice,
            descrizione || null,
            immagine || null,
            Number(active) === 0 ? 0 : 1,
            id
        ]);

        return res.json({
            message: "Product updated successfully"
        });

    } catch (error) {

        console.error("Error updating product:", error);

        return res.status(500).json({
            message: "Failed to update the product"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.get("/api/products", authenticateToken, async (req, res) => {

    let conn;

    try {

        conn = await db.getConnection();

        const rows = await conn.query(`
            SELECT
                p.id,
                p.codice,
                p.nome,
                p.descrizione,
                p.immagine,
                p.active
            FROM products p
            ORDER BY id DESC
        `);
        console.log("Products loaded:", rows.length);
        return res.json(rows);

    } catch (error) {

        console.error("Error loading products:", error);

        return res.status(500).json({
            message: "Failed to load products"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.post("/api/products", authenticateToken, async (req, res) => {

    const {
        nome,
        codice,
        descrizione,
        immagine,
        active
    } = req.body;

    let conn;

    try {

        if (!nome) {
            return res.status(400).json({
                message: "Product name is required"
            });
        }

        conn = await db.getConnection();

        /*
         * Codice temporaneo univoco.
         * Ci serve perché codice è NOT NULL e UNIQUE,
         * ma non conosciamo ancora l'ID AUTO_INCREMENT.
         */
        const codiceProvvisorio =
            `TMP-${Date.now()}`;

        const result = await conn.query(`
            INSERT INTO products
            (
            nome,
            codice,
            descrizione,
            immagine,
            active
            )
            VALUES (?, ?, ?, ?, ?)
        `, [
            nome,
            codiceProvvisorio,
            descrizione || null,
            immagine || null,
            Number(active) === 0 ? 0 : 1
        ]);

        /*
         * ID generato da MariaDB
         */
        const newId = Number(result.insertId);

        /*
         * Creo il codice prodotto
         *
         * 1   -> PRD001
         * 12  -> PRD012
         * 123 -> PRD123
         */
        const nuovoCodice =
            "PRD" + String(newId).padStart(3, "0");


        /*
         * Controllo che non esista già
         */
        const existing = await conn.query(`
            SELECT id
            FROM products
            WHERE codice = ?
              AND id <> ?
            LIMIT 1
        `, [
            nuovoCodice,
            newId
        ]);

        if (existing.length > 0) {

            // Elimino il record appena inserito
            await conn.query(
                "DELETE FROM products WHERE id = ?",
                [newId]
            );

            return res.status(409).json({
                message:
                    `Product code ${nuovoCodice} already exists`
            });
        }


        /*
         * Sostituisco il codice temporaneo
         * con quello definitivo.
         */
        await conn.query(`
            UPDATE products
            SET codice = ?
            WHERE id = ?
        `, [
            nuovoCodice,
            newId
        ]);


        return res.status(201).json({

            message:
                "Product created successfully",

            id: newId,

            codice: nuovoCodice
        });


    } catch (error) {

        console.error(
            "Error creating product:",
            error
        );

        return res.status(500).json({
            message:
                "Failed to create the product"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.get("/api/products/:id",authenticateToken, async (req, res) => {

    const id = req.params.id;
    let conn;

    try {

        conn = await db.getConnection();

        const rows = await conn.query(`
            SELECT
                p.id,
                p.codice,
                p.nome,
                p.descrizione,
                p.immagine,
                p.active
            FROM products p
            WHERE p.id = ?
            LIMIT 1
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        return res.json(rows[0]);

    } catch (error) {

        console.error("Error loading product:", error);

        return res.status(500).json({
            message: "Failed to load the product"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});

app.delete("/api/products/:id",authenticateToken, requireAdmin, async (req, res) => {

    const id = req.params.id;
    let conn;

    try {

        conn = await db.getConnection();

        // Controllo che il prodotto esista
        const rows = await conn.query(`
            SELECT id, nome
            FROM products
            WHERE id = ?
            LIMIT 1
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        await conn.query(`
            DELETE FROM products
            WHERE id = ?
        `, [id]);

        return res.json({
            message: "Product deleted successfully"
        });

    } catch (error) {

        console.error(
            "Error deleting product:",
            error
        );

        return res.status(500).json({
            message:
                "Failed to delete the product"
        });

    } finally {

        if (conn) {
            conn.release();
        }
    }
});


app.post("/api/products/upload", authenticateToken,
    uploadProduct.single("image"),
    (req, res) => {

        if (!req.file) {
            return res.status(400).json({
                message: "No image received"
            });
        }

        return res.json({
            path: `/uploads/products/${req.file.filename}`
        });
    }
);


app.get("/api/payment-methods", authenticateToken, async (req, res) => {

        let conn;

        try {

            conn = await db.getConnection();

            const rows = await conn.query(`
                SELECT
                    id,
                    code,
                    name,
                    active,
                    sort_order
                FROM payment_methods
                ORDER BY sort_order, name
            `);

            res.json(rows);

        } catch (error) {

            console.error(
                "Error loading payment methods:",
                error
            );

            res.status(500).json({
                message:
                    "Failed to load payment methods"
            });

        } finally {

            if (conn) {
                conn.release();
            }

        }
    }
);

app.post(
    "/api/payment-methods", authenticateToken, requireAdmin, async (req, res) => {

        const {
            code,
            name,
            active,
            sort_order
        } = req.body;

        let conn;

        try {

            if (!code || !name) {
                return res.status(400).json({
                    message: "Code and description are required"
                });
            }

            conn = await db.getConnection();

            // Controlliamo che il codice non esista già
            const existing = await conn.query(`
                SELECT id
                FROM payment_methods
                WHERE code = ?
                LIMIT 1
            `, [code.trim().toUpperCase()]);

            if (existing.length > 0) {
                return res.status(409).json({
                    message: "A payment method with this code already exists"
                });
            }

            const result = await conn.query(`
                INSERT INTO payment_methods
                (
                    code,
                    name,
                    active,
                    sort_order
                )
                VALUES (?, ?, ?, ?)
            `, [
                code.trim().toUpperCase(),
                name.trim(),
                active === false || active === 0 ? 0 : 1,
                Number(sort_order) || 0
            ]);

            return res.status(201).json({
                message: "Payment method created successfully",
                id: Number(result.insertId)
            });

        } catch (error) {

            console.error(
                "Error creating payment method:",
                error
            );

            return res.status(500).json({
                message: "Failed to create the payment method"
            });

        } finally {

            if (conn) {
                conn.release();
            }
        }
    }
);

app.get("/api/payment-methods/:id", authenticateToken, requireAdmin, async (req, res) => {

        const { id } = req.params;

        let conn;

        try {

            conn = await db.getConnection();

            const rows = await conn.query(`
                SELECT
                    id,
                    code,
                    name,
                    active,
                    sort_order
                FROM payment_methods
                WHERE id = ?
                LIMIT 1
            `, [id]);

            if (rows.length === 0) {
                return res.status(404).json({
                    message: "Payment method not found"
                });
            }

            return res.json(rows[0]);

        } catch (error) {

            console.error(
                "Error loading payment method:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to load the payment method"
            });

        } finally {

            if (conn) {
                conn.release();
            }
        }
    }
);

app.put(
    "/api/payment-methods/:id",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

        const { id } = req.params;

        const {
            code,
            name,
            active,
            sort_order
        } = req.body;

        let conn;

        try {

            if (!code || !name) {
                return res.status(400).json({
                    message: "Code and description are required"
                });
            }

            conn = await db.getConnection();

            // Verifica che il metodo esista
            const existingPayment = await conn.query(`
                SELECT id
                FROM payment_methods
                WHERE id = ?
                LIMIT 1
            `, [id]);

            if (existingPayment.length === 0) {
                return res.status(404).json({
                    message: "Payment method not found"
                });
            }

            // Verifica che il codice non sia usato da un altro record
            const duplicateCode = await conn.query(`
                SELECT id
                FROM payment_methods
                WHERE code = ?
                  AND id <> ?
                LIMIT 1
            `, [
                code.trim().toUpperCase(),
                id
            ]);

            if (duplicateCode.length > 0) {
                return res.status(409).json({
                    message:
                        "A payment method with this code already exists"
                });
            }

            await conn.query(`
                UPDATE payment_methods
                SET
                    code = ?,
                    name = ?,
                    active = ?,
                    sort_order = ?
                WHERE id = ?
            `, [
                code.trim().toUpperCase(),
                name.trim(),
                active === false || active === 0 ? 0 : 1,
                Number(sort_order) || 0,
                id
            ]);

            return res.json({
                message:
                    "Payment method updated successfully"
            });

        } catch (error) {

            console.error(
                "Error updating payment method:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to update the payment method"
            });

        } finally {

            if (conn) {
                conn.release();
            }
        }
    }
);

app.delete(
    "/api/payment-methods/:id", authenticateToken, requireAdmin, async (req, res) => {

        const { id } = req.params;

        let conn;

        try {

            conn = await db.getConnection();

            const existing = await conn.query(`
                SELECT id, code, name
                FROM payment_methods
                WHERE id = ?
                LIMIT 1
            `, [id]);

            if (existing.length === 0) {
                return res.status(404).json({
                    message: "Payment method not found"
                });
            }

            await conn.query(`
                DELETE FROM payment_methods
                WHERE id = ?
            `, [id]);

            return res.json({
                message: "Payment method deleted successfully"
            });

        } catch (error) {

            console.error(
                "Error deleting payment method:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to delete the payment method"
            });

        } finally {

            if (conn) {
                conn.release();
            }
        }
    }
);


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
