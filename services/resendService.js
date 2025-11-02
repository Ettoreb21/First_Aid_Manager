// services/resendService.js
// Servizio email basato su Resend SDK con invio singolo e batch,
// supporto template, allegati, logging e gestione errori.

const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const handlebars = require('handlebars');

// Iniezione del client Resend per testabilità
function createResendClient(apiKey) {
  return new Resend(apiKey);
}

function ensureLogsDir() {
  const logsDir = path.resolve(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  return logsDir;
}

function logDelivery(entry) {
  const logsDir = ensureLogsDir();
  const file = path.join(logsDir, 'email_deliveries.log');
  const line = `[${new Date().toISOString()}] ${JSON.stringify(entry)}\n`;
  fs.appendFileSync(file, line, 'utf8');
}

function logError(entry) {
  const logsDir = ensureLogsDir();
  const file = path.join(logsDir, 'email_errors.log');
  const line = `[${new Date().toISOString()}] ${JSON.stringify(entry)}\n`;
  fs.appendFileSync(file, line, 'utf8');
}

function normalizeRecipients(to) {
  // Accetta stringa, array di stringhe o array di oggetti { email, name }
  if (!to) return [];
  if (typeof to === 'string') return [to];
  if (Array.isArray(to)) return to.map(r => (typeof r === 'string' ? r : r.email));
  if (to.email) return [to.email];
  return [];
}

function buildFromAddress(email, name) {
  // Resend accetta `from` come "Nome <email@dominio>"
  if (name) return `${name} <${email}>`;
  return email;
}

// Compila un template Handlebars da file e restituisce HTML
function renderTemplateFromFile(templatePath, data) {
  const full = path.resolve(templatePath);
  const source = fs.readFileSync(full, 'utf8');
  const tpl = handlebars.compile(source);
  return tpl(data || {});
}

class ResendService {
  constructor(options = {}) {
    // Parametri di configurazione dall'ambiente
    this.apiKey = options.apiKey || process.env.RESEND_API_KEY;
    this.fromEmail = options.fromEmail || process.env.RESEND_FROM_EMAIL;
    this.fromName = options.fromName || process.env.RESEND_FROM_NAME;
    this.client = options.client || createResendClient(this.apiKey);

    if (!this.apiKey) {
      throw new Error('RESEND_API_KEY non configurata');
    }
    if (!this.fromEmail) {
      throw new Error('RESEND_FROM_EMAIL non configurata');
    }
  }

  // Verifica base: prova un invio di test in dry-run (senza consegna) usando la sintassi minima
  async verifyTransport() {
    try {
      // Non esiste un vero "dry-run" in Resend; eseguiamo una validazione basica
      if (!this.apiKey || !this.fromEmail) {
        throw new Error('Configurazione Resend incompleta');
      }
      return { ok: true, provider: 'resend', from: buildFromAddress(this.fromEmail, this.fromName) };
    } catch (err) {
      logError({ stage: 'verifyTransport', error: err.message });
      return { ok: false, error: err.message };
    }
  }

  // Invio singolo con HTML, testo opzionale e allegati
  async sendEmail({ to, subject, html, text, replyTo, attachments = [], headers = {}, tags = [], analytics = { open_tracking: true, click_tracking: true } }) {
    const recipients = normalizeRecipients(to);
    const from = buildFromAddress(this.fromEmail, this.fromName);

    // Prepara allegati per Resend: [{ filename, content }]
    const resendAttachments = (attachments || []).map(a => {
      if (a.path && !a.content) {
        return { filename: a.filename || path.basename(a.path), content: fs.readFileSync(a.path) };
      }
      return { filename: a.filename, content: a.content };
    });

    try {
      const result = await this.client.emails.send({
        from,
        to: recipients,
        subject,
        html,
        text,
        attachments: resendAttachments,
        headers,
        tags,
        reply_to: replyTo,
        // Lato Resend il tracking si gestisce via impostazioni account/webhook.
      });

      logDelivery({ action: 'sendEmail', to: recipients, subject, id: result?.id || null, status: 'requested' });
      return { ok: true, id: result?.id || null };
    } catch (err) {
      logError({ action: 'sendEmail', to: recipients, subject, error: err.message });
      return { ok: false, error: err.message };
    }
  }

  // Invio da template file Handlebars
  async sendTemplateEmail({ to, subject, templatePath, data, text, attachments = [], headers = {}, tags = [] }) {
    const html = renderTemplateFromFile(templatePath, data);
    return this.sendEmail({ to, subject, html, text, attachments, headers, tags });
  }

  // Invio batch con controllo di concorrenza semplice
  async sendBatch(emailRequests, concurrency = 3) {
    const queue = [...emailRequests];
    const results = [];

    const work = async () => {
      while (queue.length) {
        const req = queue.shift();
        const res = await this.sendEmail(req);
        results.push(res);
      }
    };

    const workers = Array.from({ length: Math.max(1, concurrency) }, () => work());
    await Promise.all(workers);
    return results;
  }
}

module.exports = {
  ResendService,
  renderTemplateFromFile,
  buildFromAddress,
  normalizeRecipients,
  createResendClient,
};