export function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err);
  const status = err.status || 500;
  const message = err.message || 'Errore interno del server';
  res.status(status).json({ error: message });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Risorsa non trovata' });
}
