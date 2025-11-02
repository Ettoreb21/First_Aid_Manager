// scripts/test-assistbot-email.js
// Invio di test AssistBot tramite services/emailService.js
// Usa BREVO_API_KEY da .env e logga l'esito

const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const { sendEmail } = require('../services/emailService');

(async () => {
  console.log('[AssistBot] Avvio test invio email...');
  const res = await sendEmail(
    'ettorebottin5@mail.com',
    'Test AssistBot',
    '<h1>Prova di invio</h1><p>Questo è un messaggio di test programmato.</p>'
  );
  console.log('[AssistBot] Esito test invio:', res);
  process.exit(res.success ? 0 : 1);
})();
