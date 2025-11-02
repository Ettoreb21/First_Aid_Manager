# Persistenza Stato Bottoni (SQL)

Questo documento descrive la struttura del database e il formato dei dati utilizzati per memorizzare permanentemente lo stato dei bottoni dell'interfaccia, garantendo compatibilità con il sistema esistente, integrità dei dati e gestione degli errori.

## Obiettivi

- Salvare automaticamente i dati inseriti/derivati nei bottoni (es. etichette dinamiche).
- Ripristinare automaticamente i valori salvati all'avvio dell'app.
- Mantenere compatibilità con l'attuale backend (Express + Sequelize) e frontend.
- Garantire integrità dei dati e resilienza I/O (fallback e log non bloccanti).

## Schema SQL

- Tabella: `button_states`
- Compatibile con SQLite e PostgreSQL.

Colonne:
- `id` (`TEXT`/`VARCHAR`, PK): identificatore univoco del bottone, corrisponde all'`id` DOM (es. `generate-report`).
- `data` (`TEXT`, NOT NULL): JSON serializzato con lo stato del bottone.
- `created_at` (`DATETIME`/`TIMESTAMP`): data creazione (gestita da ORM).
- `updated_at` (`DATETIME`/`TIMESTAMP`): data ultima modifica (gestita da ORM).

File sorgente: `scripts/button_states.sql` e modello Sequelize `models/ButtonState.js`.

## API Backend

- `GET /api/buttons` → restituisce lista stati: `[{ id, data, updatedAt }]`.
- `GET /api/buttons/:id` → stato singolo.
- `POST /api/buttons/:id` → salva/aggiorna stato, body JSON arbitrario.

Implementazione: `routes/buttons.js` e `services/buttonService.js` (cache in memoria + upsert in DB, transazioni e parse sicuro JSON).

## Formato Dati

`data` è un JSON flessibile, key-value; campi supportati e consigliati:
- `innerHTML` (`string`): markup dell'etichetta del bottone generato dalla UI.
- `disabled` (`boolean`, opzionale): stato disabilitato/abilitato.
- `title` (`string`, opzionale): tooltip/accessibility.

Esempio: stato bottone `generate-report`

```json
{
  "innerHTML": "<i class=\"fas fa-file-alt\"></i> Genera Rapporto — Uffici",
  "disabled": false,
  "title": "Genera il rapporto corrente"
}
```

## Integrazione Frontend

- Caricamento all'avvio: `loadButtonStatesFromServer()` effettua `GET /api/buttons`, applica le proprietà ai bottoni (con fallback XSS-safe).
- Salvataggio automatico: su modifiche (es. aggiornamento etichetta di `#generate-report`), `scheduleButtonAutoSave(id, data)` effettua un salvataggio debounced (`POST /api/buttons/:id`).
- Error handling: uso di `timeoutFetch` per gestire timeouts e backend non raggiungibile; log non bloccanti e UI sempre responsiva.

## Integrità e Compatibilità

- Transazioni DB per upsert in `ButtonService` garantiscono consistenza.
- Cache in memoria riduce latenza e carico.
- Il frontend non dipende dal DB per funzionare: se il backend è offline, la UI continua (localStorage mantiene dati core dell'app; stato bottoni viene semplicemente non sincronizzato).

## Reversibilità

- I salvataggi non alterano la struttura della UI; basta cancellare la riga in `button_states` per ripristinare etichetta di default.
- Il sistema salva solamente dati derivati dalla UI senza rimuovere elementi originali.

## Note Operative

- Identificatori: usare l'attributo `id` del bottone come chiave univoca.
- Estendibilità: è possibile aggiungere nuovi campi in `data` senza migrazioni, essendo JSON libero.
- Sicurezza: il frontend applica `innerHTML` generato internamente; qualora `data` provenisse da fonte non sicura, viene applicato fallback a `textContent`.