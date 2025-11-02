// Simple static file server for local preview
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = parseInt(process.argv[2], 10) || 5173;
const root = path.resolve(path.join(__dirname, '..'));

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Not Found');
    } else {
      const ext = path.extname(filePath).toLowerCase();
      const type = mimeTypes[ext] || 'application/octet-stream';
      res.statusCode = 200;
      res.setHeader('Content-Type', type);
      res.end(data);
    }
  });
}

const API_PORT = 3000;
const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    // Decide if request should be proxied to backend
    const shouldProxy = (
      urlPath.startsWith('/api/') ||
      urlPath.startsWith('/orders/') ||
      urlPath === '/generate-pdf' ||
      urlPath.startsWith('/report/')
    );

    // Proxy API and backend requests to the Node server (uploads, settings, PDF endpoints)
    if (shouldProxy) {
      const options = {
        hostname: 'localhost',
        port: API_PORT,
        path: req.url,
        method: req.method,
        headers: req.headers
      };
      const proxyReq = http.request(options, proxyRes => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });
      proxyReq.on('error', (e) => {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Bad Gateway', message: e.message }));
      });
      req.pipe(proxyReq, { end: true });
      return;
    }
    let filePath = path.join(root, urlPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
      // Fallback to index.html for SPA routes
      filePath = path.join(root, 'index.html');
    }
    serveFile(filePath, res);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Server Error: ' + (e.message || e));
  }
});

server.listen(port, () => {
  console.log(`Static server running at http://localhost:${port}/`);
});