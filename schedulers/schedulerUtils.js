// schedulers/schedulerUtils.js
// Utility per scheduling, persistenza stato e validazione notifiche

const fs = require('fs');
const path = require('path');

const TZ = 'Europe/Rome';
const LOGS_DIR = path.join(process.cwd(), 'logs');
const STATE_FILE = path.join(LOGS_DIR, 'scheduler_state.json');
const SCHEDULER_LOG = path.join(LOGS_DIR, 'scheduler.log');

function ensureLogsDir() {
  try { if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch {}
}

function isWeekend(date) {
  const d = new Date(date);
  const wd = d.getDay(); // 0=Sun, 6=Sat
  return wd === 0 || wd === 6;
}

function isFirstBusinessDay(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  // Find first day of month and then move to next Mon-Fri
  const first = new Date(Date.UTC(year, month, 1));
  // Convert to local (rough, fine for weekday determination)
  const local = new Date(year, month, 1);
  let day = local;
  while (isWeekend(day)) {
    day = new Date(year, month, day.getDate() + 1);
  }
  return d.getDate() === day.getDate() && d.getMonth() === day.getMonth() && d.getFullYear() === day.getFullYear();
}

function computeNext30Days(fromDate) {
  const base = new Date(fromDate);
  base.setHours(0, 0, 0, 0);
  const next = new Date(base);
  next.setDate(base.getDate() + 30);
  return next.toISOString();
}

// Calcolo prossima esecuzione basata su settings UI
// startDate: 'YYYY-MM-DD', sendTime: 'HH:MM', frequencyDays: integer
function parseTimeHM(sendTime) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(sendTime || '').trim());
  if (!m) return null;
  return { h: parseInt(m[1], 10), m: parseInt(m[2], 10) };
}

function computeNextRunFromSettings(startDate, frequencyDays, sendTime, now = new Date()) {
  try {
    const start = new Date(startDate);
    if (isNaN(start.getTime())) return null;
    const tm = parseTimeHM(sendTime);
    if (!tm) return null;

    // Normalizza start con orario di invio
    const first = new Date(start.getFullYear(), start.getMonth(), start.getDate(), tm.h, tm.m, 0, 0);
    const freq = parseInt(frequencyDays, 10);
    if (!Number.isFinite(freq) || freq <= 0) return null;

    // Se la prima scadenza è futura rispetto a now, torna quella
    if (first.getTime() > now.getTime()) return first;

    // Altrimenti aggiungi multipli di freq giorni finché superi now
    const next = new Date(first);
    while (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + freq);
    }
    return next;
  } catch {
    return null;
  }
}

function isDueNow(startDate, frequencyDays, sendTime, now = new Date()) {
  const next = computeNextRunFromSettings(startDate, frequencyDays, sendTime, now);
  if (!next) return false;
  // Considera due se entro la finestra del minuto corrente
  const deltaMs = Math.abs(next.getTime() - now.getTime());
  return deltaMs <= 60_000; // 1 minuto
}

function readState() {
  ensureLogsDir();
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { lastSendAt: null, nextDueAt: null, lastStatus: null };
  }
}

function writeState(state) {
  ensureLogsDir();
  const payload = { ...readState(), ...state };
  fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
  return payload;
}

function logScheduler(event) {
  ensureLogsDir();
  const entry = { ts: new Date().toISOString(), ...event };
  try { fs.appendFileSync(SCHEDULER_LOG, JSON.stringify(entry) + "\n"); } catch {}
}

function validateNotificationPayload({ to, subject, html }) {
  const issues = [];
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) issues.push('Destinatario non valido');
  if (!subject || subject.trim().length < 3) issues.push('Oggetto mancante o troppo corto');
  if (!html || html.trim().length < 5) issues.push('Contenuto HTML mancante');
  return { ok: issues.length === 0, issues };
}

module.exports = {
  TZ,
  LOGS_DIR,
  STATE_FILE,
  SCHEDULER_LOG,
  isFirstBusinessDay,
  computeNext30Days,
  computeNextRunFromSettings,
  isDueNow,
  readState,
  writeState,
  logScheduler,
  validateNotificationPayload
};