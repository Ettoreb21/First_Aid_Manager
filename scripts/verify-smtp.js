const { verifyTransport } = require('../services/emailService.js');

(async () => {
  console.log('[AssistBot] Verifica SMTP Gmail...');
  const res = await verifyTransport();
  console.log('[AssistBot] Esito verifica:', res);
})();