require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const apiAuth = require('./middleware/apiAuth');
const materialsRouter = require('./routes/materials');
const { initSequelize } = require('./db/sequelize');

const app = express();
// CORS config to support frontend on 5173 and custom headers used by app.js
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3002',
    'http://127.0.0.1:3002',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ],
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Accept','Authorization','X-Requested-With','x-api-key','x-user'],
  credentials: true,
  optionsSuccessStatus: 200
}));
// Ensure preflight returns immediately with proper headers
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  if (origin) res.header('Access-Control-Allow-Origin', origin);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Accept,Authorization,X-Requested-With,x-api-key,x-user');
  res.sendStatus(200);
});
app.use(bodyParser.json({ limit: '2mb' }));

initSequelize()
  .then(() => {
    console.log('[Materials] Sequelize initialized');
    try {
      const { start } = require('./schedulers/materialsExpiryScheduler');
      start();
    } catch (e) {
      console.warn('[Materials] Scheduler start failed or not available:', e.message);
    }
  })
  .catch((err) => {
    console.error('[Materials] Sequelize init failed:', err.message);
  });

app.use('/api', apiAuth, materialsRouter);

const port = parseInt(process.env.MATERIALS_PORT || '3005', 10);
app.listen(port, () => {
  console.log(`Materials API listening at http://localhost:${port}`);
});