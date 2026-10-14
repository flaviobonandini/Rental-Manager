const mariadb = require('mariadb');

const pool = mariadb.createPool({
    host: 'localhost',
    port: 3307,
    user: 'root',
    password: '',
    database: 'local_rental',
    connectionLimit: 5
});

module.exports = pool;