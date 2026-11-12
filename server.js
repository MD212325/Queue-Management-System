'use strict';
/**
 * Queue Management System: server entry point.
 *   npm start      run the server (serves the API and the built frontend)
 *   npm test       run the API test-suite
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const cors = require('cors');

const { loadConfig } = require('./src/config');
const { open, migrate } = require('./src/db');
const { createBus } = require('./src/sse');
const { createPush } = require('./src/push');
const { createAuth } = require('./src/auth');
const { createQueue } = require('./src/queue');
const { createRouter } = require('./src/routes');

const NOT_BUILT_PAGE = `<!doctype html><meta charset="utf-8"><title>Queue Management System</title>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:12vh auto;padding:0 20px;line-height:1.5">
<h1>The admin panel has not been built yet</h1>
<p>The server is running. To build the admin panel, run this once:</p>
<pre style="background:#f3f5f9;padding:12px;border-radius:6px">cd frontend
npm install
npm run build</pre>
<p>Then refresh this page. Meanwhile: <a href="/kiosk.html">Kiosk</a> &middot; <a href="/display.html">Public display</a></p>`;

async function start(overrides = {}) {
  const cfg = loadConfig(overrides);
  const log = (...a) => { if (!cfg.quiet) console.log(...a); };

  const db = await open(cfg.dbFile);
  await migrate(db);
  const bus = createBus();
  const push = createPush({ db, cfg });
  const queue = createQueue({ db, bus, push, cfg });
  await queue.init();
  const auth = createAuth(cfg);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' });
    next();
  });
  if (cfg.corsOrigins.length) {
    app.use(cors({ origin: cfg.corsOrigins.includes('*') ? true : cfg.corsOrigins, allowedHeaders: ['Content-Type', 'Authorization', 'x-staff-key'] }));
  }
  app.use(express.json({ limit: '20kb' }));

  // Safety net: a file by this name used to be published inside the frontend bundle with the push private key in it.
  app.use((req, res, next) => (/^\/vapid\.json$/i.test(req.path) ? res.status(404).end() : next()));

  app.use(createRouter({ cfg, auth, queue, bus, push }));

  const staticDirs = cfg.staticDirs.filter(d => fs.existsSync(d));
  for (const dir of staticDirs) {
    app.use(express.static(dir, {
      maxAge: '1h',
      setHeaders(res, file) {
        if (/(sw\.js|\.html)$/.test(file)) res.set('Cache-Control', 'no-cache');
        if (/[\\/]assets[\\/]/.test(file)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }));
  }
  const indexFile = staticDirs.map(d => path.join(d, 'index.html')).find(f => fs.existsSync(f));
  app.get('/', (_req, res) => (indexFile ? res.sendFile(indexFile) : res.status(200).type('html').send(NOT_BUILT_PAGE)));

  app.use((err, _req, res, _next) => {
    if (res.headersSent) return;
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error('Unhandled error:', err);
    const message = status >= 500 ? 'Server error' : (err.expose || err instanceof Error) ? err.message : 'Bad request';
    res.status(status).json({ error: status === 400 && err.type === 'entity.parse.failed' ? 'Invalid JSON' : message, ...(err.extra || {}) });
  });

  const server = cfg.ssl ? https.createServer(cfg.ssl, app) : http.createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(cfg.port, cfg.host, resolve); });
  const port = server.address().port;
  const scheme = cfg.ssl ? 'https' : 'http';

  let retentionTimer = null;
  if (cfg.retentionDays > 0) {
    const run = () => queue.purge(cfg.retentionDays).then(r => { if (r.tickets_removed) log(`Retention: removed ${r.tickets_removed} old ticket(s).`); }).catch(e => console.warn('Retention job failed:', e.message));
    run();
    retentionTimer = setInterval(run, 6 * 3600 * 1000);
    retentionTimer.unref();
  }

  log(`Queue Management System listening on ${scheme}://localhost:${port}`);
  log(`  Database: ${cfg.dbFile}`);
  log(`  Push notifications: ${push.enabled ? 'on' : 'off'}`);
  log(`  Frontend: ${indexFile ? path.relative(cfg.root, path.dirname(indexFile)) : 'not built (run: cd frontend && npm run build)'}`);
  for (const w of cfg.warnings) console.warn(`  ! ${w}`);

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    if (retentionTimer) clearInterval(retentionTimer);
    bus.closeAll();
    await new Promise(resolve => server.close(() => resolve()));
    server.closeAllConnections && server.closeAllConnections();
    await db.close();
  }
  return { app, server, port, close, ctx: { cfg, db, queue, bus, push, auth } };
}

if (require.main === module) {
  start().then(({ close }) => {
    for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => close().then(() => process.exit(0)));
  }).catch(err => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
}

module.exports = { start };
