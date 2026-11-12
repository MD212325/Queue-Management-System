'use strict';
/** Small shared HTTP helpers: errors, id parsing, and an in-memory rate limiter. */

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function idParam(req, name = 'id') {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id');
  return n;
}

/** Sliding-window limiter. Counts every call to hit(); fine for a single-process server. */
function createLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> number[] of timestamps
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, list] of hits) {
      const kept = list.filter(t => t > cutoff);
      if (kept.length) hits.set(k, kept); else hits.delete(k);
    }
  }, Math.min(windowMs, 60_000));
  sweep.unref();

  function peek(key) {
    const cutoff = Date.now() - windowMs;
    return (hits.get(key) || []).filter(t => t > cutoff);
  }
  return {
    /** Records a hit; returns true if the caller is still within the limit. */
    hit(key) {
      const list = peek(key);
      list.push(Date.now());
      hits.set(key, list);
      return list.length <= max;
    },
    isBlocked(key) { return peek(key).length >= max; },
    reset(key) { hits.delete(key); },
    retryAfterSeconds(key) {
      const list = peek(key);
      return list.length ? Math.max(1, Math.ceil((list[0] + windowMs - Date.now()) / 1000)) : 1;
    },
    middleware(keyFn = req => req.ip, skip = () => false) {
      return (req, res, next) => {
        if (skip(req)) return next();
        const key = keyFn(req);
        if (!this.hit(key)) {
          res.set('Retry-After', String(this.retryAfterSeconds(key)));
          return next(new HttpError(429, 'Too many requests. Please wait a moment and try again.'));
        }
        next();
      };
    },
  };
}

module.exports = { HttpError, idParam, createLimiter };
