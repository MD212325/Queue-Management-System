'use strict';
/** Web Push delivery. Silently disabled when VAPID keys are not configured. */
const webpush = require('web-push');

function createPush({ db, cfg }) {
  const { publicKey, privateKey, subject } = cfg.vapid;
  let enabled = false;
  if (publicKey && privateKey && subject) {
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      enabled = true;
    } catch (e) {
      cfg.warnings.push(`Push disabled, invalid VAPID settings: ${e.message}`);
    }
  }

  async function sendToRow(row, payload) {
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: JSON.parse(row.keys || '{}') }, JSON.stringify(payload), { TTL: 600 });
    } catch (err) {
      // 404/410 mean the browser unsubscribed; drop the dead subscription.
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        await db.write(tx => tx.run('DELETE FROM subscriptions WHERE id = ?', [row.id])).catch(() => {});
      } else if (!cfg.quiet) {
        console.warn('web-push error', err && (err.statusCode || err.message));
      }
    }
  }

  return {
    enabled,
    publicKey: enabled ? publicKey : null,
    /** Fire-and-forget; never throws. */
    async sendForTicket(ticketId, payload) {
      if (!enabled) return;
      try {
        const rows = await db.all('SELECT * FROM subscriptions WHERE ticket_id = ?', [ticketId]);
        await Promise.allSettled(rows.map(r => sendToRow(r, payload)));
      } catch (e) {
        if (!cfg.quiet) console.warn('push lookup failed', e.message);
      }
    },
  };
}
module.exports = { createPush };
