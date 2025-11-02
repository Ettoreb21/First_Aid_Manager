// scripts/send-to-isokit.js
// Verifica SMTP e invia un test a assistenza.tecnica@isokit.it

const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const { verifyTransport, sendEmail } = require('../services/emailService');

(async () => {
  console.log('[AssistBot] Verifica configurazione SMTP/Provider...');
  const verify = await verifyTransport();
  if (!verify.success) {
    console.error('[AssistBot] Verifica fallita:', verify.error);
    process.exit(1);
  }

  const to = 'assistenza.tecnica@isokit.it';
  const subject = 'TEST AssistBot — invio verso dominio isokit.it';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">
      <p>Gentile team isokit,</p>
      <p>Questo è un messaggio di test automatico inviato da AssistBot per verificare la raggiungibilità degli indirizzi @isokit.it.</p>
      <p>Timestamp: ${new Date().toLocaleString('it-IT')}</p>
      <p>Se ricevete questo messaggio, la consegna è correttamente funzionante.</p>
      <p>Cordiali saluti,<br/>AssistBot</p>
    </div>
  `;

  console.log('[AssistBot] Invio email di test a', to);
  const res = await sendEmail(to, subject, html, { replyTo: process.env.GMAIL_REPLY_TO || 'assistenza.tecnica@isokit.it' });
  console.log('[AssistBot] Esito invio:', res);

  if (res.success && res.deliveryVerified) {
    console.log('[AssistBot] Consegna verificata (accettata dal relay, nessun reject).');
    process.exit(0);
  } else if (res.success) {
    console.warn('[AssistBot] Email inviata, ma la verifica di consegna non è pienamente determinabile via SMTP.');
    process.exit(0);
  } else {
    console.error('[AssistBot] Invio fallito. Vedi logs/email_errors.log per dettagli.');
    process.exit(1);
  }
})();