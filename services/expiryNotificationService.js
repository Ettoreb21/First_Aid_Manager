const { models } = require('../db/sequelize');

function getEnv(name, fallback) {
  return process.env[name] && process.env[name].trim() !== ''
    ? process.env[name]
    : fallback;
}

async function collectExpiring(days) {
  const { Material } = models();
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const items = await Material.findAll({ order: [['data_scadenza', 'ASC']] });
  return items.filter((m) => {
    const ds = m.dataValues.data_scadenza;
    if (!ds) return false;
    const exp = new Date(ds);
    const diffDays = Math.floor((exp.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) / dayMs);
    return diffDays >= 0 && diffDays <= days;
  });
}

async function sendExpiringMaterialsReport({ to, days, thresholdCount }) {
  const dest = to || getEnv('EXPIRY_ALERT_EMAIL', 'magazzino@azienda.it');
  const windowDays = parseInt(days || getEnv('EXPIRY_THRESHOLD_DAYS', '30'), 10);
  const minCount = parseInt(thresholdCount || getEnv('EXPIRY_ALERT_THRESHOLD', '0'), 10);
  const list = await collectExpiring(windowDays);
  if (list.length < minCount) {
    return { ok: true, skipped: true, count: list.length };
  }

  const lines = list.map(
    (m) => `- ${m.nome_materiale} | cat: ${m.categoria || '-'} | scad.: ${m.data_scadenza || '-'} | forn.: ${m.fornitore || '-'}`
  );
  const text =
    `Materiali in scadenza entro ${windowDays} giorni (totale: ${list.length})\n` +
    lines.join('\n');

  // Prefer Resend if available, else fallback to emailService
  let sent;
  try {
    const resendService = require('./resendService');
    sent = await resendService.sendEmail({ to: dest, subject: 'Materiali in scadenza', text });
  } catch (e) {
    const emailService = require('./emailService');
    sent = await emailService.sendEmail({ to: dest, subject: 'Materiali in scadenza', text });
  }

  return { ok: true, to: dest, count: list.length, result: sent };
}

module.exports = { sendExpiringMaterialsReport };