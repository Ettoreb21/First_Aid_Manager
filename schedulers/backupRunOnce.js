// Esegue un backup immediato (una tantum) in base al dialect configurato
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
    console.log(`[BackupOnce] SQLite copiato in ${dest}`);
  } catch (e) {
    console.error('[BackupOnce] Errore copia SQLite:', e && e.message ? e.message : e);
    process.exitCode = 1;
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
  child.stderr.on('data', (d) => console.error('[BackupOnce] pg_dump:', d.toString()));
  child.on('exit', (code) => {
    if (code === 0) console.log(`[BackupOnce] PostgreSQL esportato in ${outfile}`);
    else {
      console.error('[BackupOnce] pg_dump terminato con codice', code);
      process.exitCode = code;
    }
  });
}

(async function run() {
  const dialect = (process.env.DB_DIALECT || 'postgres').toLowerCase();
  try {
    if (dialect === 'sqlite') await backupSqlite();
    else await backupPostgres();
  } catch (e) {
    console.error('[BackupOnce] Errore durante backup:', e && e.message ? e.message : e);
    process.exitCode = 1;
  }
})();