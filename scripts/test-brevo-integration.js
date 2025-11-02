/*
 Test integrazione Brevo per assistenza.tecnica@isokit.it
 - Verifica trasporto SMTP/API
 - Invia una email di prova
 - Controlla log per errori
*/

const path = require('path');
const fs = require('fs');
const { sendEmail, verifyTransport } = require('../services/emailService');

async function main() {
  console.log('[Brevo Test] Avvio test integrazione Brevo…');
  console.log(`[Brevo Test] Provider: ${process.env.EMAIL_PROVIDER}`);
  console.log(`[Brevo Test] Mittente: ${process.env.BREVO_SENDER_EMAIL}`);

  // 1) Verifica trasporto
  try {
    console.log('[Brevo Test] Verifico trasporto…');
    const ok = await verifyTransport();
    console.log(`[Brevo Test] Trasporto verificato: ${ok}`);
  } catch (err) {
    console.error('[Brevo Test] Errore verifica trasporto:', err.message || err);
    // continuiamo comunque con l’invio per vedere l’errore effettivo
  }

  // 2) Invio email di prova
  const to = ['assistenza.tecnica@isokit.it'];
  const subject = 'Test Brevo integrazione AssistBot';
  const html = `<p>Ciao,</p>
  <p>Questa è una email di test inviata via Brevo (${process.env.EMAIL_PROVIDER}).</p>
  <p>Ora controlleremo i log per eventuali errori. Se ricevi questa email su @isokit.it, la consegna funziona.</p>`;

  try {
    console.log('[Brevo Test] Invio email di prova…');
    const result = await sendEmail(to[0], subject, html);
    console.log('[Brevo Test] Risultato invio:', result);
  } catch (err) {
    console.error('[Brevo Test] Errore invio email:', err.message || err);
  }

  // 3) Controllo log errori Brevo
  const logPath = path.join(process.cwd(), 'logs', 'email_errors.log');
  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, 'utf8');
    const tail = content.split('\n').slice(-50).join('\n');
    const hasErrors = /brevo|smtp|error|failed|unauthorized|forbidden/i.test(tail);
    console.log('\n[Brevo Test] Ultime 50 righe di logs/email_errors.log:\n');
    console.log(tail || '(vuoto)');
    console.log(`\n[Brevo Test] Errori rilevati nei log: ${hasErrors}`);
  } else {
    console.log('[Brevo Test] Nessun file logs/email_errors.log trovato.');
  }

  console.log('\n[Brevo Test] Test completato.');
}

main().catch((e) => {
  console.error('[Brevo Test] Errore inaspettato:', e);
  process.exitCode = 1;
});