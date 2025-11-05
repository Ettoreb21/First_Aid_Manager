// Backup automatici del DB
// - SQLite: copia del file su directory backups con timestamp
// - PostgreSQL: esegue pg_dump se variabili sono presenti

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
}

async function backupSqlite() {
  const source = process.env.DB_SQLITE_PATH || './materials.sqlite';
  const backupsDir = process.env.BACKUPS_DIR || path.join(process.cwd(), 'backups');
  ensureDir(backupsDir);
  const base = path.basename(source);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupsDir, `${base}.${ts}.bak`);
  try {
    fs.copyFileSync(source, dest);
    console.log(`[Backup] SQLite copiato in ${dest}`);
  } catch (e) {
    console.error('[Backup] Errore copia SQLite:', e && e.message ? e.message : e);
  }
}

async function backupPostgres() {
  const { spawn } = require('child_process');
  const pgDumpPath = process.env.PG_DUMP_PATH || 'pg_dump';
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const database = process.env.DB_NAME || 'materials_db';
  const username = process.env.DB_USER || 'postgres';
  const password = process.env.DB_PASSWORD || '';
  const backupsDir = process.env.BACKUPS_DIR || path.join(process.cwd(), 'backups');
  ensureDir(backupsDir);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outfile = path.join(backupsDir, `pgdump_${database}_${ts}.sql`);
  const env = { ...process.env, PGPASSWORD: password };
  const args = ['-h', host, '-p', port, '-U', username, '-d', database, '-F', 'p'];
  const child = spawn(pgDumpPath, args, { env });
  const ws = fs.createWriteStream(outfile);
  child.stdout.pipe(ws);
  child.stderr.on('data', (d) => console.error('[Backup] pg_dump:', d.toString()));
  child.on('exit', (code) => {
    if (code === 0) console.log(`[Backup] PostgreSQL esportato in ${outfile}`);
    else console.error('[Backup] pg_dump terminato con codice', code);
  });
}

function scheduleBackup() {
  const dialect = (process.env.DB_DIALECT || 'postgres').toLowerCase();
  const cronSpec = process.env.BACKUP_CRON || '0 3 * * *'; // ogni giorno alle 03:00
  cron.schedule(cronSpec, async () => {
    try {
      if (dialect === 'sqlite') await backupSqlite();
      else await backupPostgres();
    } catch (e) {
      console.error('[Backup] Errore durante backup:', e && e.message ? e.message : e);
    }
  }, { timezone: process.env.BACKUP_TZ || 'Europe/Rome' });
  console.log('[Backup] Scheduler attivato (cron:', cronSpec, ')');
}

try { scheduleBackup(); } catch (e) { console.error('[Backup] Scheduler non avviato:', e && e.message ? e.message : e); }

module.exports = { scheduleBackup };