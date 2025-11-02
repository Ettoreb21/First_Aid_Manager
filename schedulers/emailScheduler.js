/**
 * schedulers/emailScheduler.js
 * Pianificazioni automatiche AssistBot con node-cron
 * - Job 1: ogni 30 giorni alle 00:00 (dimostrativo)
 * - Job 2: ogni 3 mesi (1° giorno del mese alle 00:00) (dimostrativo)
 * - Job 3: primo giorno lavorativo del mese alle 08:00 Europe/Rome
 * - Log chiari con prefisso [AssistBot]
 */

const cron = require('node-cron');
const { sendEmail } = require('../services/emailService');
const {
  TZ,
  readState,
  writeState,
  logScheduler,
  isFirstBusinessDay,
  computeNext30Days,
  computeNextRunFromSettings,
  isDueNow,
  validateNotificationPayload
} = require('./schedulerUtils');
const {
  getExpiringItemsForMonth,
  getZeroQuantityItemsFromWarehouse,
  buildItemsTable
} = require('../services/inventoryService');
const { SettingsService } = require('../services/settingsService');
const { getSequelize, models } = require('../db/sequelize');

function getSettingsService() {
  try {
    const sequelize = getSequelize();
    const { Setting } = models();
    const svc = new SettingsService(sequelize, Setting);
    return svc;
  } catch (e) {
    // Sequelize non ancora inizializzato: crea servizio con cache solo defaults
    const sequelize = null;
    const Setting = null;
    const svc = new SettingsService(sequelize, Setting);
    return svc;
  }
}

function scheduleJobs() {
  // Job 30 giorni: alle 00:00 ogni 30 giorni (dimostrativo esistente)
  cron.schedule('0 0 */30 * *', async () => {
    const stamp = new Date().toISOString();
    console.log(`[AssistBot] Job 30 giorni avviato: ${stamp}`);
    try {
      const res = await sendEmail(
        'cliente@example.com',
        'Promemoria mensile AssistBot',
        '<p>Questo è un invio automatico programmato ogni 30 giorni.</p>'
      );
      console.log('[AssistBot] Job 30 giorni esito:', res);
    } catch (err) {
      console.error('[AssistBot] Errore job 30 giorni:', err && err.message ? err.message : err);
    }
  }, { timezone: TZ });

  // Job trimestrale: alle 00:00 del 1° giorno ogni 3 mesi (dimostrativo esistente)
  cron.schedule('0 0 1 */3 *', async () => {
    const stamp = new Date().toISOString();
    console.log(`[AssistBot] Job trimestrale avviato: ${stamp}`);
    try {
      const res = await sendEmail(
        'cliente@example.com',
        'Promemoria trimestrale AssistBot',
        '<p>Questo è un invio automatico programmato ogni 3 mesi.</p>'
      );
      console.log('[AssistBot] Job trimestrale esito:', res);
    } catch (err) {
      console.error('[AssistBot] Errore job trimestrale:', err && err.message ? err.message : err);
    }
  }, { timezone: TZ });

  // Job mensile: primo giorno lavorativo del mese alle 08:00 Europe/Rome
  cron.schedule('0 8 * * *', async () => {
    const now = new Date();
    const isoNow = now.toISOString();
    const state = readState();

    if (!isFirstBusinessDay(now)) {
      logScheduler({ type: 'monthly_check', status: 'skip', reason: 'non_business_first_day', at: isoNow });
      return;
    }

    if (state.lastSendAt && state.lastSendAt.slice(0,10) === isoNow.slice(0,10)) {
      logScheduler({ type: 'monthly_check', status: 'skip', reason: 'already_sent_today', at: isoNow });
      return;
    }

    const to = 'ettorebottin5@gmail.com';
    const subject = `Notifica Mensile AssistBot - ${new Date().toLocaleDateString('it-IT')}`;

    // Dati reali da Excel
    const month = now.getMonth();
    const year = now.getFullYear();
    const expiringItems = getExpiringItemsForMonth(month, year);
    const zeroItems = getZeroQuantityItemsFromWarehouse();
    const expiringTable = buildItemsTable(expiringItems);
    const zeroTable = buildItemsTable(zeroItems);

    const html = `
      <h2>Report Mensile - Primo Giorno Lavorativo</h2>
      <p>Questo invio è programmato per il primo giorno lavorativo del mese.</p>
      <p>Data: ${new Date().toLocaleString('it-IT')} (${TZ})</p>
      <h3>Articoli in Scadenza (mese corrente)</h3>
      ${expiringTable}
      <h3 style="margin-top:16px;">Articoli con Quantità Zero</h3>
      ${zeroTable}
      <p style="margin-top:12px;">— AssistBot</p>
    `;

    const validation = validateNotificationPayload({ to, subject, html });
    if (!validation.ok) {
      logScheduler({ type: 'monthly_send', status: 'invalid_payload', issues: validation.issues, at: isoNow });
      return;
    }

    logScheduler({ type: 'monthly_send', status: 'attempt', to, subject, at: isoNow });

    try {
      const res = await sendEmail(to, subject, html);
      const success = !!(res && (res.ok || res.success));
      if (success) {
        const nextDueAt = computeNext30Days(now);
        writeState({ lastSendAt: isoNow, nextDueAt, lastStatus: 'success' });
        logScheduler({ type: 'monthly_send', status: 'success', providerRes: res, nextDueAt });
      } else {
        writeState({ lastSendAt: isoNow, lastStatus: 'failed' });
        logScheduler({ type: 'monthly_send', status: 'failed', providerRes: res });
        scheduleRetrySeries({ to, subject, html });
      }
    } catch (err) {
      writeState({ lastSendAt: isoNow, lastStatus: 'error' });
      logScheduler({ type: 'monthly_send', status: 'error', error: (err && err.message) || String(err) });
      scheduleRetrySeries({ to, subject, html });
    }
  }, { timezone: TZ });

  console.log('[AssistBot] Pianificazioni cron attivate (30gg, trimestrale, primo giorno lavorativo).');

  // Job dinamico: controlla ogni minuto se è dovuto l'invio programmato da settings
  cron.schedule('*/1 * * * *', async () => {
    const now = new Date();
    const isoNow = now.toISOString();
    const state = readState();
    const svc = getSettingsService();
    try { await svc.initCache(); } catch {}

    const startEntry = svc.get('email.schedule.start_date');
    const freqEntry = svc.get('email.schedule.frequency_days');
    const timeEntry = svc.get('email.schedule.send_time');

    const startDate = startEntry?.value || '';
    const frequencyDays = freqEntry?.value || 0;
    const sendTime = timeEntry?.value || '';

    // Se configurazione incompleta, ignora
    if (!startDate || !sendTime || !Number.isFinite(Number(frequencyDays)) || Number(frequencyDays) <= 0) {
      return;
    }

    // Evita invio se già effettuato nel minuto corrente
    if (state.lastTimedSendAt && Math.abs(new Date(state.lastTimedSendAt).getTime() - now.getTime()) < 60_000) {
      return;
    }

    const due = isDueNow(startDate, frequencyDays, sendTime, now);
    logScheduler({ type: 'timed_send_check', status: due ? 'due' : 'skip', at: isoNow, cfg: { startDate, frequencyDays, sendTime } });
    if (!due) return;

    // Costruisci contenuto basato su inventario (come job mensile)
    const toListEntry = svc.get('email.notifications.recipients');
    const subjectPrefixEntry = svc.get('email.notifications.subject_prefix');
    const recipients = Array.isArray(toListEntry?.value) ? toListEntry.value : [String(toListEntry?.value || 'assistenza.tecnica@isokit.it')];
    const subjectPrefix = subjectPrefixEntry?.value || '[AssistBot]';
    const subject = `${subjectPrefix} Invio programmato - ${new Date().toLocaleDateString('it-IT')}`;

    const month = now.getMonth();
    const year = now.getFullYear();
    const expiringItems = getExpiringItemsForMonth(month, year);
    const zeroItems = getZeroQuantityItemsFromWarehouse();
    const expiringTable = buildItemsTable(expiringItems);
    const zeroTable = buildItemsTable(zeroItems);
    const html = `
      <h2>Report Programmato</h2>
      <p>Invio pianificato da impostazioni UI: start ${startDate}, ogni ${frequencyDays} giorni alle ${sendTime}.</p>
      <p>Data: ${new Date().toLocaleString('it-IT')} (${TZ})</p>
      <h3>Articoli in Scadenza (mese corrente)</h3>
      ${expiringTable}
      <h3 style="margin-top:16px;">Articoli con Quantità Zero</h3>
      ${zeroTable}
      <p style="margin-top:12px;">— AssistBot</p>
    `;

    const validation = validateNotificationPayload({ to: recipients[0], subject, html });
    if (!validation.ok) {
      logScheduler({ type: 'timed_send', status: 'invalid_payload', issues: validation.issues, at: isoNow });
      return;
    }

    // Invia a ciascun destinatario con rate limiting basico per scalabilità
    const results = [];
    for (let i = 0; i < recipients.length; i++) {
      const to = recipients[i];
      logScheduler({ type: 'timed_send', status: 'attempt', to, subject, at: new Date().toISOString(), idx: i + 1 });
      try {
        const res = await sendEmail(to, subject, html);
        const success = !!(res && (res.ok || res.success));
        results.push({ to, success, res });
        if (!success) {
          logScheduler({ type: 'timed_send', status: 'failed', to, providerRes: res });
        }
      } catch (err) {
        results.push({ to, success: false, error: err && err.message ? err.message : String(err) });
        logScheduler({ type: 'timed_send', status: 'error', to, error: (err && err.message) || String(err) });
      }
      // Rate limit 1s tra invii per evitare burst
      await new Promise(r => setTimeout(r, 1000));
    }

    const anySuccess = results.some(r => r.success);
    const nextDueAt = computeNextRunFromSettings(startDate, frequencyDays, sendTime, now)?.toISOString?.() || null;
    writeState({ lastTimedSendAt: isoNow, nextTimedDueAt: nextDueAt, lastTimedStatus: anySuccess ? 'success' : 'failed' });

    if (!anySuccess) {
      // Programma retry della prima email come fallback
      const primary = { to: recipients[0], subject, html };
      scheduleRetrySeries(primary);
    }
  }, { timezone: TZ });
}

function scheduleRetrySeries(payload) {
  // Fallback: tenta reinvii con backoff 15m, 60m, 180m (processo attivo)
  const delays = [15 * 60_000, 60 * 60_000, 180 * 60_000];
  delays.forEach((ms, idx) => {
    setTimeout(async () => {
      const at = new Date().toISOString();
      logScheduler({ type: 'retry_attempt', attempt: idx + 1, at });
      try {
        const res = await sendEmail(payload.to, payload.subject, payload.html);
        const success = !!(res && (res.ok || res.success));
        if (success) {
          const nextDueAt = computeNext30Days(new Date());
          writeState({ lastSendAt: at, nextDueAt, lastStatus: 'success' });
          logScheduler({ type: 'retry_attempt', status: 'success', attempt: idx + 1, providerRes: res, nextDueAt });
        } else {
          logScheduler({ type: 'retry_attempt', status: 'failed', attempt: idx + 1, providerRes: res });
        }
      } catch (err) {
        logScheduler({ type: 'retry_attempt', status: 'error', attempt: idx + 1, error: (err && err.message) || String(err) });
      }
    }, ms);
  });
}

// Auto-inizializza alla prima importazione
try {
  scheduleJobs();
} catch (e) {
  console.warn('[AssistBot] Scheduler non inizializzato:', e && e.message ? e.message : e);
}

module.exports = {
  scheduleJobs
};
