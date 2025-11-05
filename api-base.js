// Override lato client per API base.
// - In locale: punta direttamente al backend Node su porta 3002
// - In produzione su domini statici: punta al backend pubblico su Render
(function(){
  try {
    const host = (typeof location !== 'undefined' && location.hostname) ? location.hostname : '';
    const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(host);
    if (isLocal) {
      // Forza l'uso del backend locale su 3002 anche se il server statico non ha proxy
      window.FAM_API_BASE = 'http://localhost:3002/api';
    } else {
      window.FAM_API_BASE = 'https://first-aid-manager.onrender.com/api';
    }
  } catch (_) {
    // fallback: non impostare override
  }
})();