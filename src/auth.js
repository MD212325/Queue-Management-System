'use strict';
/**
 * Staff authentication.
 *
 * The old app compared the staff key in the browser, and bundled the key into the JS file.
 * Now the key is only ever checked here, and the browser receives a signed, expiring token.
 *
 * Roles:  staff  = run counters (call / serve / hold / extend / walk-in tickets)
 *         admin  = staff + services, time allotments, reports, exports, data purge
 * If ADMIN_KEY is not configured, the staff key unlocks admin pages too (old behaviour).
 */
const crypto = require('crypto');
const { HttpError, createLimiter } = require('./http');

const b64 = buf => Buffer.from(buf).toString('base64url');

function safeEqual(a, b) {
  // Hash first so the comparison is constant-time even when lengths differ.
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function createAuth(cfg) {
  const loginLimiter = createLimiter(cfg.loginRate);

  const sign = body => b64(crypto.createHmac('sha256', cfg.sessionSecret).update(body).digest());

  function roleForKey(key) {
    if (!key) return null;
    if (cfg.adminKey && safeEqual(key, cfg.adminKey)) return 'admin';
    if (safeEqual(key, cfg.staffKey)) return cfg.adminKey ? 'staff' : 'admin';
    return null;
  }

  function issue(role) {
    const exp = Math.floor(Date.now() / 1000) + cfg.sessionTtlSeconds;
    const body = b64(JSON.stringify({ r: role, exp }));
    return { token: `${body}.${sign(body)}`, role, expires_at: new Date(exp * 1000).toISOString() };
  }

  function readToken(token) {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig || !safeEqual(sig, sign(body))) return null;
    try {
      const { r, exp } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (!['staff', 'admin'].includes(r) || !Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
      return { role: r, expires_at: new Date(exp * 1000).toISOString() };
    } catch { return null; }
  }

  /** Returns {role, expires_at} or null. Accepts Bearer tokens, or the legacy x-staff-key header. */
  function identify(req) {
    if (req._auth !== undefined) return req._auth;
    let who = null;
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) who = readToken(h.slice(7).trim());
    if (!who && req.headers['x-staff-key']) {
      const role = roleForKey(String(req.headers['x-staff-key']));
      if (role) who = { role, expires_at: null };
    }
    req._auth = who;
    return who;
  }

  const attach = (req, _res, next) => { req.auth = identify(req); next(); };
  const needRole = roles => (req, _res, next) => {
    const who = identify(req);
    if (!who) return next(new HttpError(401, 'Sign in required'));
    if (!roles.includes(who.role)) return next(new HttpError(403, 'Admin access required'));
    req.auth = who;
    next();
  };

  function login(req, res) {
    const key = String((req.body && req.body.key) || '').trim();
    if (!key) throw new HttpError(400, 'Enter the staff key');
    if (loginLimiter.isBlocked(req.ip)) {
      res.set('Retry-After', String(loginLimiter.retryAfterSeconds(req.ip)));
      throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
    }
    const role = roleForKey(key);
    if (!role) {
      loginLimiter.hit(req.ip); // only failures count
      throw new HttpError(401, 'That key is not correct');
    }
    loginLimiter.reset(req.ip);
    return issue(role);
  }

  return {
    attach,
    requireStaff: needRole(['staff', 'admin']),
    requireAdmin: needRole(['admin']),
    identify,
    login,
    isStaff: req => !!identify(req),
  };
}

module.exports = { createAuth };
