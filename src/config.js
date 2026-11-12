'use strict';
/**
 * Central configuration. Everything is read from environment variables (or .env).
 * loadConfig() is a function (not a singleton) so tests can inject overrides.
 */
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

const str = (v, d = '') => (v === undefined || v === null || v === '' ? d : String(v));
const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));

// The key that shipped in the original source. It is public, so never trust it.
const LEGACY_DEFAULT_KEY = 'STI-QUEUE-KEY';

function loadConfig(overrides = {}) {
  require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
  const env = { ...process.env, ...overrides };
  const warnings = [];

  let staffKey = str(env.STAFF_KEY);
  if (!staffKey) {
    staffKey = crypto.randomBytes(9).toString('base64url');
    warnings.push(`STAFF_KEY is not set. A temporary key was generated for this run: ${staffKey}`);
  } else if (staffKey === LEGACY_DEFAULT_KEY) {
    warnings.push('STAFF_KEY is still the default from the public source code. Change it in .env.');
  }
  const adminKey = str(env.ADMIN_KEY);
  if (adminKey && adminKey === staffKey) warnings.push('ADMIN_KEY equals STAFF_KEY, so staff can open Settings and Reports.');

  const sslKey = str(env.HTTPS_KEY_FILE);
  const sslCert = str(env.HTTPS_CERT_FILE);
  const ssl = sslKey && sslCert && fs.existsSync(sslKey) && fs.existsSync(sslCert)
    ? { key: fs.readFileSync(sslKey), cert: fs.readFileSync(sslCert) }
    : null;
  if ((sslKey || sslCert) && !ssl) warnings.push('HTTPS_KEY_FILE / HTTPS_CERT_FILE are set but unreadable; falling back to HTTP.');

  const vapid = {
    publicKey: str(env.VAPID_PUBLIC_KEY),
    privateKey: str(env.VAPID_PRIVATE_KEY),
    subject: str(env.VAPID_SUBJECT),
  };

  const cfg = {
    root: ROOT,
    port: int(env.PORT, 4000),
    host: str(env.HOST, '0.0.0.0'),
    dbFile: str(env.DB_FILE, path.join(ROOT, 'queue.db')),
    staffKey,
    adminKey, // optional: when empty, the staff key also unlocks admin pages
    // Derived from the keys unless set explicitly, so sessions survive a restart
    // and are automatically invalidated when a key is rotated.
    sessionSecret: str(env.SESSION_SECRET) ||
      crypto.createHash('sha256').update(`qms-session|${staffKey}|${adminKey}`).digest('hex'),
    sessionTtlSeconds: int(env.SESSION_TTL_HOURS, 12) * 3600,
    vapid,
    // Customer names are personal data. Hide them from public screens unless opted in.
    publicShowNames: bool(env.PUBLIC_SHOW_NAMES, false),
    corsOrigins: str(env.CORS_ORIGINS).split(',').map(s => s.trim()).filter(Boolean),
    retentionDays: int(env.RETENTION_DAYS, 30), // 0 disables automatic cleanup
    ticketRate: { windowMs: int(env.TICKET_RATE_WINDOW_SECONDS, 300) * 1000, max: int(env.TICKET_RATE_MAX, 30) },
    loginRate: { windowMs: 15 * 60 * 1000, max: int(env.LOGIN_RATE_MAX, 10) },
    trustProxy: /^\d+$/.test(str(env.TRUST_PROXY, 'loopback')) ? Number(env.TRUST_PROXY) : str(env.TRUST_PROXY, 'loopback'),
    ssl,
    staticDirs: [path.join(ROOT, 'frontend', 'dist'), path.join(ROOT, 'frontend', 'public')],
    quiet: bool(env.QUIET, false),
    warnings,
  };

  if (vapid.subject || vapid.publicKey || vapid.privateKey) {
    if (!(vapid.subject && vapid.publicKey && vapid.privateKey)) {
      warnings.push('Push notifications are disabled: set all three of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.');
    }
  }
  return cfg;
}

module.exports = { loadConfig };
