# 📧 Integrazione AssistBot (Brevo API v3)

Questa sezione documenta l'integrazione del servizio email automatico e pianificato tramite Brevo (Sendinblue) API v3, con mittente `assitenza.tecnica@isokit.it` e nome `AssistBot`.

## Requisiti
- Node.js 16+ (consigliata LTS)
- Dipendenze: `sib-api-v3-sdk`, `node-cron`, `dotenv`
- Chiave Brevo API v3 (64 caratteri) salvata in `.env`

## Installazione dipendenze
Eseguire nella root del progetto:

```
npm install sib-api-v3-sdk node-cron dotenv
```

Le dipendenze vengono aggiunte a `package.json`. Se il server è già in esecuzione, riavviare dopo l'installazione.

## Configurazione `.env`
Creare (o aggiornare) il file `.env` nella root del progetto con:

```
BREVO_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- La chiave deve essere una API v3 Key (64 caratteri) generata in Brevo.
- Non committare mai `.env` nel VCS.

## Struttura modulare
- `services/emailService.js`: incapsula l'uso di Brevo SDK e espone `sendEmail(toEmail, subject, htmlContent)`.
- `schedulers/emailScheduler.js`: definisce due job cron (ogni 30 giorni, ogni 3 mesi) che invocano `sendEmail()`.

## Integrazione nello startup
Il progetto usa CommonJS. Lo scheduler viene avviato importando il modulo nello startup (`server.js`):

```js
require('./schedulers/emailScheduler');
```

Se si usa ESM, l'equivalente è:

```js
import './schedulers/emailScheduler.js';
```

## Test di invio manuale
Si può testare un invio manuale richiamando la funzione `sendEmail` direttamente (ad esempio da uno script di test o da un endpoint esistente):

```js
const { sendEmail } = require('./services/emailService');

(async () => {
  const res = await sendEmail(
    'cliente@example.com',
    'Test AssistBot',
    '<h1>Prova di invio</h1><p>Questo è un messaggio di test.</p>'
  );
  console.log('[AssistBot] Test result:', res);
})();
```

Nel file `services/emailService.js` è presente anche un esempio commentato attivabile manualmente.

## Funzionamento cron automatici
- Job 1: ogni 30 giorni alle 00:00 (`cron.schedule('0 0 */30 * *', ...)`).
- Job 2: ogni 3 mesi, il primo giorno alle 00:00 (`cron.schedule('0 0 1 */3 *', ...)`).
- Timezone: `Europe/Rome`.
- Log con prefisso `[AssistBot]` documentano avvio ed esito.

Per modificare pianificazione, soggetto, contenuto o destinatari:
- Aprire `schedulers/emailScheduler.js` e aggiornare i parametri di `sendEmail()`.
- È possibile aggiungere nuovi job duplicando lo schema `cron.schedule(...)` e personalizzando oggetto/contenuto.

## Scelte architetturali
- API v3 (SDK) al posto di SMTP: maggiore affidabilità, tracciamento, template e gestione errori nativa.
- Moduli separati (`services/` e `schedulers/`) per facilitare riuso (notifiche, report) e manutenzione.

## Troubleshooting
- `net::ERR_CONNECTION_REFUSED`: verificare che il server sia avviato (`npm start`) e che non ci siano conflitti di porta; provare `http://127.0.0.1:3000/`.
- Chiave Brevo non valida: assicurarsi che `BREVO_API_KEY` sia lunga 64 caratteri.
- Firewall Windows: consentire traffico in uscita per Node.

## Sicurezza
- Non inserire chiavi in chiaro nel codice.
- Utilizzare `.env` per configurazioni sensibili.

## Verifica
- Eseguire: `npm start`.
- Controllare i log `[AssistBot]` al boot per conferma scheduler.
- Effettuare un invio manuale di test e verificare la ricezione.

---

# 🚀 Nuova integrazione: Resend (SDK ufficiale)

Questa sezione spiega come configurare e utilizzare Resend come provider email principale.

## Requisiti
- Node.js 16+
- Dipendenza: `resend`

## Installazione

```
npm install resend
```

## Configurazione `.env`

```
EMAIL_PROVIDER=resend
RESEND_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
RESEND_FROM_EMAIL=noreply@yourdomain.com
RESEND_FROM_NAME=Your Company
```

Assicurati di verificare il mittente in Resend Dashboard.

## Funzionalità
- Invio email singole e batch
- Template Handlebars (`services/templateService.js`)
- Tracking aperture/click/bounce via webhook `/webhooks/resend`
- Allegati e HTML avanzato
- Logging dettagliato su `logs/email_deliveries.log` e `logs/email_errors.log`

## Uso rapido

Invio singolo (via servizio generico):

```js
const { sendEmail } = require('./services/emailService');
await sendEmail('dest@example.com', 'Oggetto', '<p>Contenuto</p>');
```

Invio da template:

```js
const { ResendService } = require('./services/resendService');
const svc = new ResendService();
await svc.sendTemplateEmail({
  to: 'dest@example.com',
  subject: 'Benvenuto',
  templatePath: './templates/welcome.html',
  data: { name: 'Mario' }
});
```

Invio batch:

```js
const { ResendService } = require('./services/resendService');
const svc = new ResendService();
await svc.sendBatch([
  { to: 'a@example.com', subject: 'A', html: '<p>A</p>' },
  { to: 'b@example.com', subject: 'B', html: '<p>B</p>' }
], 3);
```

## Webhook tracking
Configura in Resend Dashboard il webhook verso:

```
POST /webhooks/resend
```

Gli eventi vengono salvati in `logs/` distinguendo bounce dagli altri.

## Test
Esegui i test unitari della nuova integrazione:

```
npm test
```

Il test usa un client Resend mock per validare invio singolo, batch e rendering template.

## Note
- L'endpoint `/api/send-email` ora instrada verso Resend quando `EMAIL_PROVIDER=resend`, altrimenti usa Brevo (legacy).
- Manteniamo compatibilità con `flushOutbox` di Brevo per non interrompere i flussi esistenti.

---

## Affidabilità & Error Handling (Frontend/Backend)

Per evitare gli errori di rete ripetuti all’avvio (es. `net::ERR_ABORTED`, `net::ERR_FAILED`) quando il backend non è raggiungibile o è in wake-up:

- Il frontend effettua un health check (`/api/health`) e imposta `app.backendReady` prima di eseguire chiamate dipendenti dal backend.
- Le chiamate di startup a `/api/settings`, `/api/buttons`, `/api/materiali` e `auth/me` vengono eseguite solo quando `backendReady === true`.
- La funzione `timeoutFetch` usa un timeout “soft” (senza `AbortController`) e restituisce risposte sintetiche 408 (timeout) o 503 (unreachable), con logging strutturato del tempo e dell’URL, evitando rumore in console.
- Su GitHub Pages si evita il fallback `same-origin /api`: viene usato `window.FAM_API_BASE` (Render) come unica base API.

### CORS e Cookie (Render)
- Impostare `CORS_ORIGINS` includendo gli origin del frontend (es. `https://ettorebottin.github.io`).
- `NODE_ENV=production`; `SESSION_SECRET` configurato.
- Cookie cross-site: `COOKIE_SECURE=true`, `COOKIE_SAMESITE=None`.

### Verifica locale
- Eseguire `npm test` per validare `/api/health` e la preflight `OPTIONS` su `/api/auth/login` (porta 3004).
- Aprire il preview locale e verificare in console `app.backendReady`; quando è `false`, il frontend non effettua chiamate verso `/api/...`.

---

# Deploy su Render (Produzione)

Questa sezione definisce requisiti tecnici, configurazione, build/deploy automatici e monitoraggio per l'ambiente di produzione su Render.

## Requisiti runtime
- `NODE_VERSION=18.x` (LTS consigliata, compatibile con dipendenze attuali)
- `PORT` fornita da Render (iniettata automaticamente); il server legge `process.env.PORT`
- Health check: `GET/HEAD /api/health` (attivo e idempotente)

## Variabili di ambiente (produzione)
- Sicurezza e CORS
  - `NODE_ENV=production`
  - `SESSION_SECRET` (obbligatoria, valore robusto)
  - `CORS_ORIGINS=https://ettorebottin.github.io` (aggiungere eventuali altri origin)
  - `COOKIE_SAMESITE=None`
  - `COOKIE_SECURE=true`
- Email provider (scegliere uno):
  - `EMAIL_PROVIDER=brevo` oppure `EMAIL_PROVIDER=resend` (default: brevo)
  - Brevo: `BREVO_API_KEY` (secret), `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, opzionale SMTP `BREVO_SMTP_*`
  - Resend: `RESEND_API_KEY` (secret), `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`
- Logging
  - `LOG_LEVEL=info` (valori: error, warn, info, debug)
- Database (scegliere uno):
  - SQLite: `DB_DIALECT=sqlite`, `DB_SQLITE_PATH=./data/materials.sqlite` (richiede Persistent Disk)
  - Postgres: `DB_DIALECT=postgres` e credenziali `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`

## Build e start (Render)
- Build command: `npm ci`
- Start command: `node server.js`
- Health check path: `/api/health` (Render lo usa per determinare l’uptime del servizio)

## Persistent Disk (SQLite)
- Se si usa SQLite in produzione, attivare un Persistent Disk su Render (es. 1GB) e usare percorso `./data/materials.sqlite`.
- Il percorso effettivo su Render è sotto `~/project/src/`; assicurarsi che la cartella `data/` esista o venga creata al boot.

## Auto-deploy e CI/CD
- Auto-deploy: attivare “Auto deploy” su Render per il branch `main` del repository GitHub collegato.
- CI GitHub Actions: presente workflow `./.github/workflows/ci.yml` che esegue i test su push/PR.
- Deploy Hook (opzionale): impostare il secret `RENDER_DEPLOY_HOOK` su GitHub per triggerare deploy da Actions.

## Monitoraggio e Logging
- Health check applicativo: `HEAD https://<render-app>/api/health` deve rispondere `200`.
- Preflight CORS: `OPTIONS https://<render-app>/api/auth/login` con header `Origin` dell’app deve rispondere `204/200` e includere `access-control-allow-origin`.
- Log applicativi:
  - Email: `logs/email_deliveries.log`, `logs/email_errors.log` (rotazione manuale o integrazione esterna)
  - Console: visibile nel dashboard Render; impostare `LOG_LEVEL` per granularità

## Checklist di verifica post-deploy
- Apri `https://ettorebottin.github.io/First_Aid_Manager/` e verifica assenza di `net::ERR_FAILED` in console.
- Esegui `curl -I https://first-aid-manager.onrender.com/api/health` e verifica `HTTP/2 200`.
- Testa login/logout e CRUD materiali; cookie devono essere `Secure` e `SameSite=None`.
- Se il backend entra in sleep, il primo `HEAD` può impiegare qualche secondo; il frontend ha retry/backoff.

## Note operative
- In caso di lentezza al wake-up su Render, aumenta il timeout del health check o esegui un `GET /api/health` dopo il `HEAD`.
- Mantieni `CORS_ORIGINS` allineato agli origin reali (GitHub Pages e eventuali domini custom).
- Evita di esporre le chiavi nelle issue o nel codice: usa sempre i “Secret” del dashboard Render e di GitHub.