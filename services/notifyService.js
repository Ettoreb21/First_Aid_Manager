// Notifiche per eventi critici (Slack webhook o email fallback)
const axios = require('axios');
const { sendEmail } = require('./emailService');

async function notifyCritical(message, meta = {}) {
  const webhook = process.env.NOTIFY_SLACK_WEBHOOK_URL || '';
  const to = process.env.NOTIFY_EMAIL_TO || '';
  const payload = {
    text: `[Critical] ${message}`,
    attachments: [
      { color: 'danger', text: 'Metadata', fields: Object.entries(meta).map(([k,v]) => ({ title: k, value: String(v), short: true })) }
    ]
  };
  try {
    if (webhook) {
      await axios.post(webhook, payload, { timeout: 5000 });
      return { ok: true, channel: 'slack' };
    }
  } catch (e) {
    // fall through to email
  }
  try {
    if (to) {
      await sendEmail(to, '[Critical] First Aid Manager', `<pre>${message}</pre><pre>${JSON.stringify(meta, null, 2)}</pre>`);
      return { ok: true, channel: 'email' };
    }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
  return { ok: false, error: 'No notification channel configured' };
}

module.exports = { notifyCritical };