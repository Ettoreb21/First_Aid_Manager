// Avvio server su porta di test 3004
require('../server-boot-3004');

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const url = 'http://localhost:3004/api/health';
  let attempts = 0;
  let lastErr = null;
  while (attempts < 10) {
    attempts++;
    try {
      const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
      if (res.ok && json && json.status === 'ok') {
        console.log(`[test] /api/health OK:`, json);
        process.exit(0);
      } else {
        console.warn(`[test] /api/health non OK: status=${res.status}, body=${text}`);
      }
    } catch (e) {
      lastErr = e;
      console.warn(`[test] errore richiesta health:`, e.message);
    }
    await wait(500);
  }
  console.error(`[test] /api/health FAILED`, lastErr ? lastErr.message : 'unknown error');
  process.exit(1);
}

run();