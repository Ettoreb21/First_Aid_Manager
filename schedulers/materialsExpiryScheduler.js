const { sendExpiringMaterialsReport } = require('../services/expiryNotificationService');

function start() {
  let cron;
  try {
    cron = require('node-cron');
  } catch (e) {
    console.warn('[MaterialsScheduler] node-cron not installed. Skipping weekly job.');
    return;
  }

  const schedule = process.env.MATERIALS_WEEKLY_CRON || '0 8 * * 1'; // Monday 08:00
  cron.schedule(schedule, async () => {
    try {
      const to = process.env.EXPIRY_ALERT_EMAIL || undefined;
      const days = process.env.EXPIRY_THRESHOLD_DAYS || undefined;
      const thresholdCount = process.env.EXPIRY_ALERT_THRESHOLD || undefined;
      const result = await sendExpiringMaterialsReport({ to, days, thresholdCount });
      console.log('[MaterialsScheduler] Weekly expiry report:', result);
    } catch (err) {
      console.error('[MaterialsScheduler] Error sending weekly report:', err.message);
    }
  });

  console.log('[MaterialsScheduler] Weekly cron job scheduled:', schedule);
}

module.exports = { start };