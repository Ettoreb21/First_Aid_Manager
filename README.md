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