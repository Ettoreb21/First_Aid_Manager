// Avvio server su porta di test 3004
require('../server-boot-3004');

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const origin = 'http://localhost:5173';
  const url = 'http://localhost:3004/api/auth/login';
  // Attendi che il server sia pronto
  await wait(500);
  try {
    const res = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        'Origin': origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Accept,Authorization,X-Requested-With,x-api-key,x-user'
      }
    });
    const acao = res.headers.get('Access-Control-Allow-Origin');
    const acc = res.headers.get('Access-Control-Allow-Credentials');
    const acm = res.headers.get('Access-Control-Allow-Methods');
    const ach = res.headers.get('Access-Control-Allow-Headers');
    if (res.status === 200 && acao === origin && acc === 'true' && acm?.includes('POST') && ach?.includes('x-api-key')) {
      console.log('[test] CORS preflight OPTIONS OK');
      process.exit(0);
    } else {
      console.error('[test] CORS preflight FAILED', { status: res.status, acao, acc, acm, ach });
      process.exit(1);
    }
  } catch (e) {
    console.error('[test] preflight error', e.message);
    process.exit(1);
  }
}

run();