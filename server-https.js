const fs = require('fs');
const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3443;
const HTTP_BACKEND = process.env.HTTP_BACKEND || 'http://127.0.0.1:3002';
const keyPath = process.env.SSL_KEY_PATH || '';
const certPath = process.env.SSL_CERT_PATH || '';

if (!keyPath || !certPath || !fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('Certificati SSL non configurati o mancanti. Imposta SSL_KEY_PATH e SSL_CERT_PATH.');
  process.exit(1);
}

const options = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
};

const server = https.createServer(options, (req, res) => {
  const backendUrl = new URL(HTTP_BACKEND);
  const requestOptions = {
    hostname: backendUrl.hostname,
    port: backendUrl.port || 80,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(requestOptions, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('Errore proxy HTTPS -> HTTP:', err);
    res.writeHead(502);
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(PORT, () => {
  console.log(`🔒 HTTPS reverse proxy attivo su https://127.0.0.1:${PORT} verso ${HTTP_BACKEND}`);
});