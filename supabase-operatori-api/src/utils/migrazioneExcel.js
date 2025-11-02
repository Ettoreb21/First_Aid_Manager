import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { pool } from '../db/connect.js';
import { ensureTable } from '../services/operatori.service.js';

function nowTs() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function validateColumns(headers) {
  const required = ['nome','email','reparto','stato','quantita','quantita_minima','tag'];
  const missing = required.filter((r) => !headers.includes(r));
  if (missing.length) {
    throw new Error(`Colonne mancanti: ${missing.join(', ')}`);
  }
}

function sanitizeRow(row) {
  // Rimuove righe incomplete: richiede almeno nome e reparto e stato
  if (!row.nome || !row.reparto || !row.stato) return null;
  // Default numerici
  row.quantita = Number(row.quantita ?? 0);
  row.quantita_minima = Number(row.quantita_minima ?? 0);
  return row;
}

async function main() {
  const start = Date.now();
  const excelPath = process.env.EXCEL_FILE_PATH || 'dati/operatori.xlsx';
  const absPath = path.isAbsolute(excelPath) ? excelPath : path.join(process.cwd(), excelPath);

  if (!fs.existsSync(absPath)) {
    console.error(`[Migrazione] File non trovato: ${absPath}`);
    process.exit(1);
  }

  // Backup con timestamp
  const backupDir = path.join(process.cwd(), 'backup');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `operatori_${nowTs()}.xlsx`);
  fs.copyFileSync(absPath, backupPath);

  // Parse Excel
  const workbook = XLSX.readFile(absPath);
  const sheetName = workbook.SheetNames[0];
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });
  if (!data.length) {
    console.error('[Migrazione] Nessun dato nel file Excel.');
    process.exit(1);
  }

  // Validazione intestazioni
  const headers = Object.keys(data[0]).map(h => h.trim());
  validateColumns(headers);

  // Sanitize + filtraggio
  const sanitized = data.map(sanitizeRow).filter(Boolean);
  const discarded = data.length - sanitized.length;

  // Connessione DB e creazione tabella
  await ensureTable();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Batch insert con valori multipli
    const cols = ['nome','email','reparto','stato','quantita','quantita_minima','tag'];
    const values = [];
    const params = [];
    let idx = 1;
    for (const row of sanitized) {
      values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      params.push(row.nome, row.email, row.reparto, row.stato, row.quantita, row.quantita_minima, row.tag);
    }

    if (values.length) {
      const insertSql = `INSERT INTO operatori (${cols.join(',')}) VALUES ${values.join(',')}`;
      await client.query(insertSql, params);
    }

    await client.query('COMMIT');

    const durationSec = Math.round((Date.now() - start) / 1000);
    console.log(`[Migrazione] Importate: ${sanitized.length}, Scartate: ${discarded}, Tempo: ${durationSec}s`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migrazione] ERRORE, rollback eseguito:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

main();
