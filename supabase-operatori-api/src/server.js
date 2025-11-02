import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
dotenv.config();

import operatoriRoutes from './routes/operatori.routes.js';
import saluteRoutes from './routes/salute.routes.js';
import { errorHandler, notFoundHandler } from './utils/errorHandler.js';
import { ensureTable } from './services/operatori.service.js';

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/api/operatori', operatoriRoutes);
app.use('/api/salute', saluteRoutes);

// Not found & Errors
app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  try {
    // Rimuove la connessione TCP Postgres; effettua solo un check non-bloccante
    await ensureTable();
    app.listen(port, () => {
      console.log(`[Server] In ascolto su http://localhost:${port}`);
    });
  } catch (err) {
    console.error('[Startup Error]', err);
    process.exit(1);
  }
}

start();
