const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function canonicalizeOrderData({ operatorId, operatorName, city, date, items, traceId }) {
  // Rappresentazione canonica stabile per firma
  const normalizedItems = (Array.isArray(items) ? items : []).map(it => ({
    code: String(it.code || ''),
    name: String(it.name || ''),
    location: String(it.location || ''),
    reorderQty: Number(it.reorderQty || 0),
    expiryDate: String(it.expiryDate || ''),
    type: String(it.type || '')
  }));
  // Ordina per codice+ubicazione per stabilità
  normalizedItems.sort((a, b) => {
    const ka = `${a.code}@@${a.location}`;
    const kb = `${b.code}@@${b.location}`;
    return ka.localeCompare(kb);
  });
  return {
    operatorId: String(operatorId || ''),
    operatorName: String(operatorName || ''),
    city: String(city || ''),
    date: String(date || ''),
    items: normalizedItems,
    traceId: String(traceId || '')
  };
}

function getPublicKeyFingerprint(pubKeyPem) {
  if (!pubKeyPem) return undefined;
  const hash = crypto.createHash('sha256').update(pubKeyPem).digest('hex');
  return hash.slice(0, 16); // fingerprint breve
}

function signCanonicalData(canonical, options = {}) {
  const algo = process.env.SIGN_ALGO || options.algo || 'RSA-SHA256';
  const privateKey = process.env.SIGN_PRIVATE_KEY_PEM || options.privateKeyPem;
  const secret = process.env.SIGN_SECRET || options.secret;
  const payload = JSON.stringify(canonical);
  const signedAt = new Date().toISOString();
  let signature;
  let signatureAlgo = algo;
  let publicKeyPem = process.env.SIGN_PUBLIC_KEY_PEM || options.publicKeyPem;

  if (privateKey) {
    const signer = crypto.createSign(algo);
    signer.update(payload);
    signer.end();
    signature = signer.sign(privateKey).toString('base64');
  } else {
    // Fallback HMAC (integrità e autenticità lato server)
    signatureAlgo = 'HMAC-SHA256';
    const hmac = crypto.createHmac('sha256', secret || 'default-secret-change-me');
    hmac.update(payload);
    signature = hmac.digest('base64');
  }

  const signatureId = crypto.createHash('sha256').update(signature).digest('hex').slice(0, 12);
  const pubFingerprint = getPublicKeyFingerprint(publicKeyPem);
  return { signature, signatureAlgo, signatureId, signedAt, publicKeyFingerprint: pubFingerprint };
}

function verifyCanonicalData(canonical, signature, options = {}) {
  const payload = JSON.stringify(canonical);
  const algo = process.env.SIGN_ALGO || options.algo || 'RSA-SHA256';
  const publicKeyPem = process.env.SIGN_PUBLIC_KEY_PEM || options.publicKeyPem;
  const secret = process.env.SIGN_SECRET || options.secret;

  if (publicKeyPem) {
    const verifier = crypto.createVerify(algo);
    verifier.update(payload);
    verifier.end();
    return verifier.verify(publicKeyPem, Buffer.from(signature, 'base64'));
  } else {
    const hmac = crypto.createHmac('sha256', secret || 'default-secret-change-me');
    hmac.update(payload);
    const expected = hmac.digest('base64');
    return expected === signature;
  }
}

function ensureLedger() {
  const dir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ledgerPath = path.join(dir, 'signatures.json');
  if (!fs.existsSync(ledgerPath)) fs.writeFileSync(ledgerPath, JSON.stringify({ entries: [] }, null, 2));
  return ledgerPath;
}

function appendLedger(entry) {
  const ledgerPath = ensureLedger();
  const raw = fs.readFileSync(ledgerPath, 'utf-8');
  const data = JSON.parse(raw);
  data.entries.push(entry);
  fs.writeFileSync(ledgerPath, JSON.stringify(data, null, 2));
}

function findLedgerBySignatureId(signatureId) {
  const ledgerPath = ensureLedger();
  const raw = fs.readFileSync(ledgerPath, 'utf-8');
  const data = JSON.parse(raw);
  return (data.entries || []).find(e => e.signatureId === signatureId);
}

module.exports = {
  canonicalizeOrderData,
  signCanonicalData,
  verifyCanonicalData,
  appendLedger,
  findLedgerBySignatureId
};