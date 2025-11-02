// tests/scheduler.test.js
// Test unitari per util di scheduling mensile

const assert = require('assert');
const {
  isFirstBusinessDay,
  computeNext30Days,
  validateNotificationPayload
} = require('../schedulers/schedulerUtils');

(function testIsFirstBusinessDay() {
  // 1 Feb 2025 is Saturday -> first business day should be 3 Feb (Monday)
  const feb1 = new Date(2025, 1, 1); // JS months: 0=Jan, 1=Feb -> 1 Feb 2025
  assert(isFirstBusinessDay(new Date(2025, 1, 3)) === true, '3 Feb 2025 deve essere primo giorno lavorativo');
  assert(isFirstBusinessDay(feb1) === false, '1 Feb 2025 non è giorno lavorativo');

  // 1 Oct 2024 is Tuesday -> should be first business day
  const oct1 = new Date(2024, 9, 1);
  assert(isFirstBusinessDay(oct1) === true, '1 Ott 2024 deve essere primo giorno lavorativo');
})();

(function testComputeNext30Days() {
  const base = new Date(2024, 9, 1); // 1 Oct 2024
  const next = new Date(computeNext30Days(base));
  assert(next.getDate() === 31 && next.getMonth() === 9, 'Next 30 giorni da 1 Ott deve essere 31 Ott 2024');
})();

(function testValidateNotificationPayload() {
  const ok = validateNotificationPayload({ to: 'user@example.com', subject: 'Test', html: '<p>Hi</p>' });
  assert(ok.ok === true, 'Payload valido deve risultare ok');
  const bad = validateNotificationPayload({ to: 'not-an-email', subject: 'T', html: '' });
  assert(bad.ok === false && bad.issues.length >= 2, 'Payload invalido deve segnalare errori');
  console.log('Tutti i test schedulerUtils passati');
})();