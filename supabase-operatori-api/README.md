# Supabase Operatori API

API REST modulare in Node.js + Express (ES Modules) per la gestione degli **operatori**, con migrazione dati da Excel verso Supabase (PostgreSQL).

## Caratteristiche
- Struttura progetto chiara (`src/routes`, `src/controllers`, `src/services`, `src/db`, `src/utils`).
- ES Modules (`type: module`) e avvio con `nodemon` (`npm run dev`).
- Configurazione tramite `.env` (nessuna credenziale hard-coded).
- Database: **Supabase/PostgreSQL** con pooling `pg` e SSL.
- Migrazione dati da Excel (`xlsx`) con **validazione**, **filtri**, **batch insert**, **backup**, **transazioni/rollback**.
- API REST complete per `operatori` (CRUD) + endpoint salute.
- Middleware: **CORS**, **morgan** (logger), **error handler** centralizzato.

## Struttura del progetto
```
supabase-operatori-api/
  .env.example
  package.json
  README.md
  src/
    server.js
    db/connect.js
    routes/
      operatori.routes.js
      salute.routes.js
    controllers/operatori.controller.js
    services/operatori.service.js
    utils/errorHandler.js
    utils/migrazioneExcel.js
```

## Setup
1. Copia `.env.example` in `.env` e compila le variabili:
```
PORT=3001
DB_HOST=your-supabase-host.supabase.co
DB_USER=postgres
DB_PASSWORD=your-strong-password
DB_NAME=postgres
DB_PORT=5432
DB_SSL=true
EXCEL_FILE_PATH=dati/operatori.xlsx
```

2. Installa le dipendenze:
```
npm install
```

3. Avvia il server in sviluppo (con nodemon):
```
npm run dev
```
Il server parte su `http://localhost:3001`.

## Migrazione Excel → DB
- Posiziona il file Excel in `dati/operatori.xlsx` o specifica `EXCEL_FILE_PATH` nel `.env`.
- Il foglio deve contenere le colonne: `nome, email, reparto, stato, quantita, quantita_minima, tag`.
- Esegui la migrazione:
```
npm run migra
```
- Lo script:
  - Valida le colonne richieste.
  - Filtra righe vuote/incomplete.
  - Esegue **INSERT batch** in transazione (con **ROLLBACK** su errore).
  - Crea backup del file originale in `backup/` con timestamp.
  - Logga: importate, scartate, tempo totale.

## API REST
- `GET /api/operatori` → elenco operatori
- `GET /api/operatori/:id` → dettaglio operatore
- `POST /api/operatori` → crea operatore
- `PUT /api/operatori/:id` → aggiorna operatore
- `DELETE /api/operatori/:id` → elimina operatore
- `GET /api/salute` → `{ status: "ok", uptime: <secondi> }`

## Scelte tecniche
- **ES Modules**: interoperabilità moderna e chiara separazione dei moduli.
- **pg Pooling**: connessioni gestite con timeouts e `max` per stabilità.
- **SSL opzionale**: richiesto da Supabase, disattivabile in ambienti locali.
- **Batch insert**: ottimizza prestazioni evitando inserimenti per singola riga.
- **Middleware centralizzati**: CORS, logger, errori → semplifica manutenzione.
- **Struttura a layer** (routes → controllers → services → db): favorisce riuso e testabilità.

## Deployment (Render/Railway)
- Imposta variabili ambiente nello UI del provider (`PORT`, `DB_*`).
- Esegui `npm start` come comando di avvio.
- Assicurati che il database Supabase sia raggiungibile e SSL compatibile.

## Note di sicurezza
- Nessuna credenziale hard-coded: usa solo `.env` o variabili ambiente.
- Limita l’esposizione del server con CORS solo al frontend conosciuto, se necessario.

## Estensioni future
- Validazioni schema con `zod` o `joi` per input API.
- Paginazione e ricerca per `/api/operatori`.
- Migrazione incrementale con upsert.
