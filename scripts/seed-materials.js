require('dotenv').config();
const { initSequelize, models } = require('../db/sequelize');

async function run() {
  // Ensure SQLite for local seed unless overridden
  if (!process.env.DB_DIALECT) process.env.DB_DIALECT = 'sqlite';
  if (!process.env.DB_SQLITE_PATH) process.env.DB_SQLITE_PATH = './materials.sqlite';

  const { models: m } = await initSequelize();
  const { Material, MaterialLog } = m;

  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);

  const samples = [
    {
      nome_materiale: 'Pacco garze',
      categoria: 'Medicazione',
      quantita: 50,
      unita_misura: 'pezzi',
      data_acquisizione: fmt(new Date(today.getTime() - 30 * 24 * 3600 * 1000)),
      data_scadenza: '2025-12-31',
      fornitore: 'Fornitore Srl',
      note: 'Confezioni singole',
    },
    {
      nome_materiale: 'Cerotti',
      categoria: 'Medicazione',
      quantita: 100,
      unita_misura: 'pezzi',
      data_acquisizione: fmt(new Date(today.getTime() - 10 * 24 * 3600 * 1000)),
      data_scadenza: '2026-06-30',
      fornitore: 'HealthCare Spa',
      note: 'Assortiti',
    },
    {
      nome_materiale: 'Disinfettante',
      categoria: 'Igiene',
      quantita: 20,
      unita_misura: 'bottiglie',
      data_acquisizione: fmt(new Date(today.getTime() - 5 * 24 * 3600 * 1000)),
      data_scadenza: fmt(new Date(today.getTime() + 20 * 24 * 3600 * 1000)),
      fornitore: 'Clean&Care',
      note: '500ml',
    },
  ];

  const created = await Material.bulkCreate(samples, { returning: true });
  for (const mat of created) {
    await MaterialLog.create({ id_record: mat.id, utente: 'seed', operazione: 'INSERT' });
  }

  console.log(`Seed completato: inseriti ${created.length} materiali.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Errore seed materiali:', err);
    process.exit(1);
  });