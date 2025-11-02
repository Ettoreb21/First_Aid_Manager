// Script di test per invio email con Resend
// Uso: node scripts/send-resend-hello.js
// Requisiti: impostare RESEND_API_KEY e RESEND_FROM_EMAIL in .env

require('dotenv').config();
const { Resend } = require('resend');

// Carica la chiave API da variabile d'ambiente (non hardcodare in codice!)
const apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
  console.error('[Resend] ERRORE: RESEND_API_KEY non impostata in .env');
  process.exit(1);
}

// Mittente e destinatario di test (il mittente deve essere verificato in Resend)
const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const toEmail = process.env.RESEND_TEST_TO || 'edithia.bot@gmail.com';

(async () => {
  const resend = new Resend(apiKey);
  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: 'Hello World',
      html: '<p>Congrats on sending your <strong>first email</strong>!</p>'
    });

    if (error) throw error;

    console.log('[Resend] Email inviata. Message ID:', data?.id);
    process.exit(0);
  } catch (err) {
    console.error('[Resend] Invio fallito:', err);
    process.exit(1);
  }
})();