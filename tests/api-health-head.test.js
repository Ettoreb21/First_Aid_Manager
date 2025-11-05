// Test semplice per la route HEAD /api/health su porta 3004
const http = require('http');

async function run() {
  process.env.PORT = '3004';
  process.env.NODE_ENV = 'test';
  const server = require('../server');

  function fetchHead(url) {
    return new Promise((resolve, reject) => {
      const req = http.request(url, { method: 'HEAD' }, (res) => {
        resolve({ statusCode: res.statusCode, headers: res.headers });
      });
      req.on('error', reject);
      req.end();
    });
  }

  const url = 'http://localhost:3004/api/health';
  try {
    const res = await fetchHead(url);
    if (res.statusCode !== 200) {
      console.error(`[test] HEAD /api/health non OK: status=${res.statusCode}`);
      process.exit(1);
    }
    console.log('[test] HEAD /api/health OK');
    process.exit(0);
  } catch (err) {
    console.error('[test] HEAD /api/health FAILED', err.message);
    process.exit(1);
  } finally {
    try { server.close && server.close(); } catch (_) {}
  }
}

run();