// tests/resendService.test.js
// Test unitari basilari per ResendService e TemplateService

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { ResendService } = require('../services/resendService');
const { render } = require('../services/templateService');

// Mock client Resend con comportamento controllato
class MockResendClient {
  constructor() { this.sent = []; }
  emails = {
    send: async ({ from, to, subject, html }) => {
      if (!to || !subject || !html) {
        const err = new Error('Invalid payload');
        err.code = 'invalid_payload';
        throw err;
      }
      const id = `test_${Date.now()}`;
      this.sent.push({ id, from, to, subject, html });
      return { id };
    }
  }
}

function setupTempTemplate() {
  const dir = path.join(__dirname, '..', 'templates');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const file = path.join(dir, 'test_template.html');
  fs.writeFileSync(file, '<h1>Ciao {{name}}</h1>', 'utf8');
  return file;
}

(async () => {
  // Test TemplateService
  const tplPath = setupTempTemplate();
  const html = render(tplPath, { name: 'Mondo' });
  assert(html.includes('Ciao Mondo'), 'Il template deve renderizzare correttamente');

  // Test ResendService invio singolo con mock
  const mock = new MockResendClient();
  const svc = new ResendService({ apiKey: 'dummy', fromEmail: 'noreply@example.com', fromName: 'AssistBot', client: mock });
  const res = await svc.sendEmail({ to: 'user@example.com', subject: 'Test', html: '<p>Prova</p>' });
  assert(res.ok === true && typeof res.id === 'string', 'Invio singolo deve restituire id');

  // Test ResendService invio batch
  const batch = await svc.sendBatch([
    { to: 'a@example.com', subject: 'A', html: '<p>A</p>' },
    { to: 'b@example.com', subject: 'B', html: '<p>B</p>' }
  ], 2);
  assert(batch.length === 2 && batch.every(r => r.ok), 'Batch deve inviare due email con esito ok');

  console.log('Tutti i test ResendService passati');
})();