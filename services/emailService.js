/**
 * services/emailService.js
 * AssistBot - Servizio email con provider switch (Brevo | Gmail SMTP)
 * - Provider di default: Brevo (API v3)
 * - Config sicura via .env
 * - Funzione asincrona sendEmail(toEmail, subject, htmlContent)
 * - verifyTransport: verifica login/config a seconda del provider
 */

const path = require('path');
// Carica .env PRIMA di importare moduli che leggono process.env
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const nodemailer = require('nodemailer');
const brevoMailer = require('../brevo-mailer.js');
const { ResendService } = require('./resendService');
const fs = require('fs');

const PROVIDER = (process.env.EMAIL_PROVIDER || 'brevo').toLowerCase();
let resendService = null;
if (PROVIDER === 'resend') {
  try {
    resendService = new ResendService();
  } catch (err) {
    console.error('[AssistBot] Config Resend non valida:', err.message || err);
  }
}

// Setup logging files
const LOG_DIR = path.resolve(process.cwd(), 'logs');
try { if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
const DELIVERY_LOG = path.join(LOG_DIR, 'email_deliveries.log');
const ERROR_LOG = path.join(LOG_DIR, 'email_errors.log');

function logDelivery(details) {
  try {
    fs.appendFileSync(DELIVERY_LOG, `${new Date().toISOString()} ${JSON.stringify(details)}\n`);
  } catch {}
}

function logErrorToFile(error, context = {}) {
  try {
    fs.appendFileSync(ERROR_LOG, `${new Date().toISOString()} ${JSON.stringify({ error: String(error && error.message ? error.message : error), ...context })}\n`);
  } catch {}
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function isDeliveryLikely(info, toEmail) {
  const accepted = Array.isArray(info?.accepted) ? info.accepted.includes(toEmail) : false;
  const noRejects = !(info?.rejected && info.rejected.length);
  const okResp = typeof info?.response === 'string' ? /\b(Ok|queued|Accepted)\b/i.test(info.response) : false;
  return !!(accepted && noRejects && okResp);
}

async function sendWithRetry(transporter, mailOptions, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const info = await transporter.sendMail(mailOptions);
      return { success: true, info, attempt };
    } catch (err) {
      lastError = err;
      logErrorToFile(err, { phase: 'sendMail', attempt, to: mailOptions.to, subject: mailOptions.subject });
      if (attempt < maxAttempts) {
        const delay = Math.min(500 * Math.pow(2, attempt - 1), 2000);
        await sleep(delay);
      }
    }
  }
  return { success: false, error: lastError };
}

// ===== Gmail config (usata solo se EMAIL_PROVIDER=gmail) =====
const GMAIL_USER = process.env.GMAIL_USER;
const RAW_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const GMAIL_APP_PASSWORD = (RAW_APP_PASSWORD || '').replace(/\s+/g, '');
const SMTP_HOST = process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.GMAIL_SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.GMAIL_SMTP_SECURE || 'true').toLowerCase() === 'true';

let transporter = null;
if (PROVIDER === 'gmail') {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD
    }
  });
}

// ===== Brevo config (usata se EMAIL_PROVIDER=brevo) =====
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || '';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || '';
// Brevo SMTP fallback settings (if xsmtpsib key is provided)
const BREVO_SMTP_HOST = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
const BREVO_SMTP_PORT = Number(process.env.BREVO_SMTP_PORT || 587);
const BREVO_SMTP_SECURE = String(process.env.BREVO_SMTP_SECURE || 'false').toLowerCase() === 'true';
const BREVO_SMTP_USER = process.env.BREVO_SMTP_USER || BREVO_SENDER_EMAIL; // Brevo login/email
// Permetti di forzare SMTP Brevo anche con chiave API xkeysib via env
const BREVO_SMTP_ENABLE = String(process.env.BREVO_SMTP_ENABLE || 'false').toLowerCase() === 'true';
// Consenti password SMTP dedicata, fallback alla API key se non impostata
const BREVO_SMTP_PASS = process.env.BREVO_SMTP_PASS || BREVO_API_KEY;
const USE_BREVO_SMTP = BREVO_SMTP_ENABLE || /^xsmtpsib-/.test(BREVO_API_KEY);
let brevoSmtpTransporter = null;
if (PROVIDER === 'brevo' && USE_BREVO_SMTP) {
  brevoSmtpTransporter = nodemailer.createTransport({
    host: BREVO_SMTP_HOST,
    port: BREVO_SMTP_PORT,
    secure: BREVO_SMTP_SECURE,
    auth: {
      user: BREVO_SMTP_USER,
      pass: BREVO_SMTP_PASS
    }
  });
}

/**
 * Verifica la connessione/Configurazione del provider corrente
 * - Gmail: esegue transporter.verify()
 * - Brevo: valida presenza e forma delle variabili (API key 64 char)
 */
async function verifyTransport() {
  const trace = '[AssistBot]';
  try {
    if (PROVIDER === 'gmail') {
      if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
        throw new Error('GMAIL_USER o GMAIL_APP_PASSWORD non impostati');
      }
      await transporter.verify();
      console.log(`${trace} SMTP Gmail verificato: login OK`);
      return { success: true };
    }

    // Resend
    if (PROVIDER === 'resend') {
      if (!resendService) {
        throw new Error('ResendService non inizializzato');
      }
      const res = await resendService.verifyTransport();
      if (!res.ok) {
        throw new Error(`Verifica Resend fallita: ${res.error}`);
      }
      console.log(`${trace} Resend configurato: from=${res.from}`);
      return { success: true };
    }

    // Brevo
    if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL || !BREVO_SENDER_NAME) {
      throw new Error('Config Brevo incompleta: BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME');
    }
    const isLikelyBrevoKey = /^x(?:smtp|keys)sib-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?$/.test(BREVO_API_KEY) || BREVO_API_KEY.length >= 40;
    if (!isLikelyBrevoKey) {
      throw new Error('BREVO_API_KEY non sembra valida: verifica il formato della chiave');
    }
    if (USE_BREVO_SMTP) {
      await brevoSmtpTransporter.verify();
      console.log(`${trace} SMTP Brevo verificato: user=${BREVO_SMTP_USER}, host=${BREVO_SMTP_HOST}, port=${BREVO_SMTP_PORT}, secure=${BREVO_SMTP_SECURE}`);
    } else {
      console.log(`${trace} Config Brevo API valida: sender=${BREVO_SENDER_EMAIL}`);
    }
    return { success: true };
  } catch (err) {
    console.error(`${trace} Verifica provider fallita:`, err && err.message ? err.message : err);
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * Invia una email HTML via provider corrente
 */
async function sendEmail(toEmail, subject, htmlContent, options = {}) {
  const trace = '[AssistBot]';
  try {
    if (!toEmail || !subject || !htmlContent) {
      throw new Error('Parametri obbligatori mancanti: toEmail, subject, htmlContent');
    }

    const baseOptions = {
      to: toEmail,
      subject,
      html: htmlContent,
      text: options.text,
      cc: options.cc,
      bcc: options.bcc,
      replyTo: options.replyTo,
      attachments: options.attachments
    };

    if (PROVIDER === 'gmail') {
      const mailOptions = {
        from: '"AssistBot" <' + (GMAIL_USER || 'no-reply@example.com') + '>',
        to: baseOptions.to,
        subject: baseOptions.subject,
        html: baseOptions.html,
        text: baseOptions.text,
        cc: baseOptions.cc,
        bcc: baseOptions.bcc,
        replyTo: baseOptions.replyTo,
        attachments: baseOptions.attachments
      };
      const res = await sendWithRetry(transporter, mailOptions, 3);
      if (!res.success) {
        console.error(`${trace} [Gmail] Invio fallito dopo retry:`, res.error?.message || res.error);
        logErrorToFile(res.error, { provider: 'gmail', to: toEmail, subject });
        return { success: false, error: res.error?.message || String(res.error) };
      }
      const info = res.info;
      const deliveryVerified = isDeliveryLikely(info, toEmail);
      console.log(`${trace} [Gmail] Email inviata a ${toEmail} (messageId=${info.messageId || 'n/a'})`);
      logDelivery({ provider: 'gmail', to: toEmail, subject, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected, response: info.response, deliveryVerified });
      return {
        success: true,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
        deliveryVerified
      };
    }

    // Resend branch
    if (PROVIDER === 'resend') {
      if (!resendService) {
        throw new Error('ResendService non inizializzato');
      }
      const result = await resendService.sendEmail({
        to: baseOptions.to,
        subject: baseOptions.subject,
        html: baseOptions.html,
        text: baseOptions.text,
        replyTo: baseOptions.replyTo,
        attachments: (baseOptions.attachments || []).map(a => {
          if (a?.path) return { filename: a.filename || path.basename(a.path), content: fs.readFileSync(a.path) };
          return { filename: a.filename, content: a.content };
        }),
        headers: {},
        tags: ['AssistBot']
      });
      if (!result.ok) {
        console.error(`${trace} [Resend] Invio fallito:`, result.error);
        logErrorToFile(result.error, { provider: 'resend', to: toEmail, subject });
        return { success: false, error: result.error };
      }
      console.log(`${trace} [Resend] Email inviata a ${toEmail} (id=${result.id || 'n/a'})`);
      logDelivery({ provider: 'resend', to: toEmail, subject, messageId: result.id, response: 'Resend SDK', deliveryVerified: !!result.id });
      return { success: true, messageId: result.id, response: 'Resend SDK', deliveryVerified: !!result.id };
    }

    // Brevo branch
    if (USE_BREVO_SMTP) {
      const mailOptions = {
        from: `"${BREVO_SENDER_NAME || 'AssistBot'}" <${BREVO_SENDER_EMAIL}>`,
        to: baseOptions.to,
        subject: baseOptions.subject,
        html: baseOptions.html,
        text: baseOptions.text,
        cc: baseOptions.cc,
        bcc: baseOptions.bcc,
        replyTo: baseOptions.replyTo,
        attachments: baseOptions.attachments
      };
      const res = await sendWithRetry(brevoSmtpTransporter, mailOptions, 3);
      if (!res.success) {
        console.error(`${trace} [Brevo SMTP] Invio fallito dopo retry:`, res.error?.message || res.error);
        logErrorToFile(res.error, { provider: 'brevo_smtp', to: toEmail, subject });
        return { success: false, error: res.error?.message || String(res.error) };
      }
      const info = res.info;
      const deliveryVerified = isDeliveryLikely(info, toEmail);
      console.log(`${trace} [Brevo SMTP] Email inviata a ${toEmail} (messageId=${info.messageId || 'n/a'})`);
      logDelivery({ provider: 'brevo_smtp', to: toEmail, subject, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected, response: info.response, deliveryVerified });
      return {
        success: true,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
        deliveryVerified
      };
    } else {
      const result = await brevoMailer.sendBrevoEmail({
        to: toEmail,
        subject,
        html: htmlContent,
        tags: ['AssistBot']
      });
      console.log(`${trace} [Brevo API] Email inviata a ${toEmail} (messageId=${result.messageId || 'n/a'})`);
      logDelivery({ provider: 'brevo_api', to: toEmail, subject, messageId: result.messageId, response: 'Brevo API v3', deliveryVerified: !!result.messageId });
      return {
        success: true,
        messageId: result.messageId,
        response: 'Brevo API v3',
        deliveryVerified: !!result.messageId
      };
    }
  } catch (err) {
    console.error(`${trace} Errore invio email:`, err && err.message ? err.message : err);
    logErrorToFile(err, { provider: PROVIDER, to: toEmail, subject });
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  sendEmail,
  verifyTransport
};
