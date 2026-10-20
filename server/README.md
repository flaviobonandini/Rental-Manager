# Registrazione utenti

Il client permette di creare un account con username, email e password.
Prima di salvarlo, il server controlla che username ed email non siano già
presenti in `users`. Gli account creati pubblicamente hanno ruolo `user`,
livello `10` e sono subito attivi; non viene inviata alcuna email.

La password deve contenere almeno 8 caratteri ed è salvata tramite bcrypt.

## Prenotazioni

L'endpoint autenticato `GET /api/rentals` restituisce le prenotazioni da
`rental_service`, includendo il nome del servizio tramite `services` e nome,
cognome e username del proprietario tramite `users`. Gli amministratori vedono
tutte le prenotazioni; gli altri utenti vedono solo quelle intestate al proprio
account.

Gli amministratori possono consultare una prenotazione con
`GET /api/rentals/:id`, caricare le opzioni con `GET /api/rental-options`,
modificare con `PUT /api/rentals/:id` ed eliminarla con
`DELETE /api/rentals/:id`. Il pulsante per creare una prenotazione simile apre
il nuovo flusso con servizio e proprietario preimpostati, richiedendo la scelta
di uno slot libero.

Tutti gli utenti autenticati possono creare una prenotazione con
`POST /api/rentals`. Gli amministratori specificano il proprietario; per gli
altri utenti il proprietario è sempre ricavato dall'identità del token.
Il server assegna il numero nel formato `RTS-DDMMYY-XXXX`, con progressivo
giornaliero a quattro cifre, e crea la prenotazione in stato `REQUEST`.

La creazione avviene in due fasi: prima si seleziona il servizio, poi si
sceglie un'ora libera dalla griglia settimanale. Gli slot durano un'ora e
iniziano tra le 08:00 e le 18:00 (chiusura entro le 19:00). Il calendario
settimanale recupera gli slot occupati da
`GET /api/rental-availability?from=YYYY-MM-DD&to=YYYY-MM-DD`; la disponibilità
è condivisa tra utenti e servizi. In modifica, gli amministratori possono
aggiungere `excludeId` per non considerare occupato lo slot della prenotazione
stessa. Le prenotazioni annullate non bloccano uno slot. L'API verifica
nuovamente la disponibilità al momento della creazione o modifica.

## Prenotazioni prodotti

Gli endpoint autenticati `/api/rental-products` gestiscono le prenotazioni
registrate in `rental_product`, collegate al catalogo `products` tramite
`produc_id`. La lista include il nome prodotto e i dati del proprietario; gli
utenti vedono le proprie prenotazioni e gli amministratori tutte. Le opzioni
per il form sono fornite da `GET /api/rental-product-options` usando i prodotti
attivi (`products.nome`).

Gli utenti autenticati possono creare prenotazioni con `POST
/api/rental-products`; gli amministratori possono leggere e modificare una
singola prenotazione con `GET` e `PUT /api/rental-products/:id`, ed eliminarla
con `DELETE`. Il numero è generato nel formato `RTP-DDMMYY-XXXX`.
`GET /api/rental-product-availability` controlla le date selezionate e
l'API ricontrolla la disponibilità al salvataggio: gli intervalli sono
[inizio, fine), quindi la data di rientro non occupa un giorno aggiuntivo.
Le prenotazioni attive dello stesso prodotto non possono sovrapporsi; quelle
annullate non bloccano la disponibilità. Gli amministratori possono escludere
la prenotazione corrente dal controllo disponibilità con `excludeId`.

## Avvio

Dalla radice del progetto avvia il backend con `npm start` e il client con
`npm run dev --prefix client`.
