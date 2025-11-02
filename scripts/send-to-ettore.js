// scripts/send-to-ettore.js
// Verifica SMTP, compone contenuto completo e invia a ettorebottin5@gmail.com

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const { verifyTransport, sendEmail } = require('../services/emailService');

function findLatestPdf(reportDir) {
  try {
    if (!fs.existsSync(reportDir)) return null;
    const files = fs.readdirSync(reportDir)
      .filter(f => f.toLowerCase().endsWith('.pdf'))
      .map(f => ({ name: f, full: path.join(reportDir, f), mtime: fs.statSync(path.join(reportDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? files[0].full : null;
  } catch { return null; }
}

(async () => {
  console.log('[AssistBot] Verifica configurazione SMTP/Provider...');
  const verify = await verifyTransport();
  if (!verify.success) {
    console.error('[AssistBot] Verifica fallita:', verify.error);
    process.exit(1);
  }

  const to = 'ettorebottin5@gmail.com';
  const subject = 'Report aggiornato AssistBot — verifica sistema primo soccorso';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">
      <p>Gentile destinatario,</p>
      <p>
        Ti inviamo il report aggiornato relativo alla verifica del sistema di primo soccorso.
        In allegato trovi il PDF generato automaticamente dal sistema AssistBot.
      </p>
      <p>
        Dettagli:
        <ul>
          <li>Generato: ${new Date().toLocaleString()}</li>
          <li>Mittente: ${process.env.BREVO_SENDER_NAME || 'AssistBot'} &lt;${process.env.BREVO_SENDER_EMAIL}&gt;</li>
          <li>Canale: Brevo SMTP</li>
        </ul>
      </p>
      <p>
        Per qualsiasi chiarimento, rispondi pure a questa email.
      </p>
      <p>Cordiali saluti,<br/>AssistBot</p>
    </div>
  `;

  // Allegati: cerca l'ultimo PDF in ./report
  const reportDir = path.join(process.cwd(), 'report');
  let attachmentPath = findLatestPdf(reportDir);
  let attachments = [];

  if (attachmentPath && fs.existsSync(attachmentPath)) {
    attachments.push({ filename: path.basename(attachmentPath), path: attachmentPath });
  } else {
    // Fallback: crea un piccolo promemoria
    const fallbackDir = path.join(process.cwd(), 'temp');
    try { if (!fs.existsSync(fallbackDir)) fs.mkdirSync(fallbackDir, { recursive: true }); } catch {}
    const fallbackPath = path.join(fallbackDir, 'promemoria.txt');
    try { fs.writeFileSync(fallbackPath, 'Promemoria: nessun PDF trovato nella cartella report.'); } catch {}
    attachments.push({ filename: 'promemoria.txt', path: fallbackPath });
  }

  console.log('[AssistBot] Invio email a', to, 'con', attachments.length, 'allegato/i');
  const res = await sendEmail(to, subject, html, { attachments });
  console.log('[AssistBot] Esito invio:', res);

  // Verifica consegna (accettazione da relay + assenza errori)
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
