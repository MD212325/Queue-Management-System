'use strict';
const express = require('express');
const { HttpError, idParam, createLimiter } = require('./http');

function createRouter({ cfg, auth, queue, bus, push }) {
  const r = express.Router();
  const ticketLimiter = createLimiter(cfg.ticketRate);
  const staff = auth.requireStaff;
  const admin = auth.requireAdmin;
  const isStaff = req => !!req.auth;

  r.use(auth.attach);
  r.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  /* ------------------------------- public ------------------------------- */
  r.get('/health', (_req, res) => res.json({ ok: true }));
  r.get('/events', (req, res) => bus.handler(req, res));

  r.get('/services', (_req, res) => {
    res.json(queue.serviceList().map(s => ({ key: s.key, label: s.label, prefix: s.prefix, allotted_seconds: s.allotted_seconds })));
  });

  r.get('/queue', async (req, res) => res.json(await queue.listActive({ names: isStaff(req) })));
  r.get('/stats', async (_req, res) => res.json(await queue.stats()));
  r.get('/push/key', (_req, res) => res.json({ publicKey: push.publicKey }));

  r.get('/ticket/:id', async (req, res) => res.json(await queue.ticketView(idParam(req), { names: isStaff(req) })));

  r.post('/ticket', ticketLimiter.middleware(req => req.ip, isStaff), async (req, res) => {
    res.json(await queue.createTicket(req.body || {}, { staff: isStaff(req) }));
  });

  r.post('/ticket/:id/request_cancel', async (req, res) => {
    res.json(await queue.requestCancel(idParam(req), req.body || {}, { staff: isStaff(req) }));
  });

  r.post('/subscribe', async (req, res) => res.json(await queue.subscribe(req.body || {})));

  /* -------------------------------- auth -------------------------------- */
  r.post('/auth/login', (req, res) => res.json(auth.login(req, res)));
  r.get('/auth/me', staff, (req, res) => res.json(req.auth));

  /* -------------------------------- staff -------------------------------- */
  r.get('/admin/snapshot', staff, async (_req, res) => res.json(await queue.snapshot()));
  r.get('/admin/history', staff, async (_req, res) => res.json(await queue.historyToday()));

  r.post('/next', staff, async (req, res) => {
    const service = req.body && req.body.service;
    if (!service) throw new HttpError(400, 'service required');
    res.json(await queue.callNext(String(service)));
  });
  r.post('/serve/:id', staff, async (req, res) => res.json(await queue.serve(idParam(req), req.body && req.body.service ? String(req.body.service) : null)));
  r.post('/hold/:id', staff, async (req, res) => res.json(await queue.hold(idParam(req))));
  r.post('/recall/:id', staff, async (req, res) => res.json(await queue.recall(idParam(req))));
  r.post('/reassign/:id', staff, async (req, res) => res.json(await queue.reassign(idParam(req), req.body && req.body.service ? String(req.body.service) : null)));
  r.post('/ticket/:id/extend', staff, async (req, res) => res.json(await queue.extend(idParam(req), req.body && req.body.seconds)));
  r.post('/ticket/:id/clear_cancel', staff, async (req, res) => res.json(await queue.clearCancel(idParam(req))));
  r.delete('/ticket/:id', staff, async (req, res) => res.json(await queue.remove(idParam(req))));

  /* -------------------------------- admin -------------------------------- */
  r.post('/admin/services', admin, async (req, res) => res.status(201).json(await queue.createService(req.body || {})));
  r.put('/admin/services/:key', admin, async (req, res) => res.json(await queue.updateService(String(req.params.key), req.body || {})));
  r.get('/admin/reports', admin, async (req, res) => {
    const range = ['today', '7d', '30d'].includes(req.query.range) ? req.query.range : 'today';
    res.json(await queue.reports(range));
  });
  r.post('/admin/purge', admin, async (req, res) => res.json(await queue.purge(req.body && req.body.older_than_days)));
  r.get('/export.csv', admin, async (req, res) => {
    const type = req.query.type === 'stages' ? 'stages' : 'tickets';
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${type}.csv"` });
    res.send(await queue.exportCsv(type));
  });

  return r;
}

module.exports = { createRouter };
