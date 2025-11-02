import dotenv from 'dotenv';
dotenv.config();

import postgres from 'postgres';

const {
  DATABASE_URL,
  DB_HOST,
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  DB_PORT,
  DB_SSL,
} = process.env;

function buildConnectionString() {
  if (DATABASE_URL) return DATABASE_URL;
  if (!DB_HOST || !DB_USER || !DB_NAME || !DB_PORT) {
    console.error("Errore configurazione DB: imposta DATABASE_URL oppure le variabili .env per la connessione");
    process.exit(1);
  }
  const encPass = encodeURIComponent(DB_PASSWORD || '');
  const base = `postgresql://${DB_USER}:${encPass}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
  const sslSuffix = DB_SSL === 'true' ? '?sslmode=require' : '';
  return `${base}${sslSuffix}`;
}

const connectionString = buildConnectionString();

export const sql = postgres(connectionString);

export async function connectDB() {
  await sql`SELECT 1`;
  console.log('[DB] Connessione OK');
}
