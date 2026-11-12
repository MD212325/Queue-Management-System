'use strict';
/**
 * Queue domain logic. Routes stay thin and call into this module.
 *
 * Ticket lifecycle
 *   waiting --(call)--> called --(serve)--> waiting at the next service | served
 *                         |--(hold)--> hold --(recall)--> called
 *
 * Time allotment
 *   Every service has an allotted time per customer. When a ticket is CALLED the current
 *   allotment is copied onto the ticket (allotted_seconds), so later edits in Settings never
 *   change a visit that is already in progress. Staff can add time with extend().
 *   When the visit ends, one row is written to service_log. That log drives the reports and
 *   the "estimated wait" shown to customers.
 */
const crypto = require('crypto');
const { HttpError } = require('./http');

const ACTIVE = ['waiting', 'called', 'hold'];
const MIN_COUNTED_SECONDS = 10; // ignore accidental instant clicks in averages
const MAX_EXTENSION_TOTAL = 3600;

const iso = (d = new Date()) => d.toISOString();
const pad3 = n => String(n).padStart(3, '0');

function parseServices(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function startOfLocalDay(daysBack = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.toISOString();
}

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
}

function createQueue({ db, bus, push, cfg }) {
  let services = new Map();
  const avgCache = new Map();

  /* ------------------------------- services ------------------------------- */

  async function refreshServices() {
    const rows = await db.all('SELECT * FROM services ORDER BY sort_order, key');
    services = new Map(rows.map(r => [r.key, { ...r, enabled: !!r.enabled }]));
    avgCache.clear();
  }
  const serviceList = ({ includeDisabled = false } = {}) =>
    [...services.values()].filter(s => includeDisabled || s.enabled);
  const prefixOf = key => (services.get(key) || {}).prefix || (key ? String(key)[0].toUpperCase() : '');
  const displayToken = (id, key) => prefixOf(key) + pad3(id);

  function cleanServiceFields(input, { creating }) {
    const out = {};
    if (creating || input.key !== undefined) {
      const key = String(input.key || '').trim().toLowerCase();
      if (!/^[a-z0-9_-]{2,24}$/.test(key)) throw new HttpError(400, 'Service id must be 2-24 letters, numbers, - or _');
      out.key = key;
    }
    if (creating || input.label !== undefined) {
      const label = String(input.label || '').trim();
      if (!label || label.length > 40) throw new HttpError(400, 'Name must be 1-40 characters');
      out.label = label;
    }
    if (creating || input.prefix !== undefined) {
      const prefix = String(input.prefix || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{1,2}$/.test(prefix)) throw new HttpError(400, 'Ticket letter must be 1-2 letters or numbers');
      out.prefix = prefix;
    }
    if (creating || input.allotted_seconds !== undefined) {
      const s = Math.round(Number(input.allotted_seconds));
      if (!Number.isFinite(s) || s < 30 || s > 7200) throw new HttpError(400, 'Allotted time must be between 30 seconds and 120 minutes');
      out.allotted_seconds = s;
    }
    if (input.enabled !== undefined) out.enabled = input.enabled ? 1 : 0;
    if (input.sort_order !== undefined) out.sort_order = Math.max(0, Math.min(999, parseInt(input.sort_order, 10) || 0));
    return out;
  }

  async function createService(input) {
    const f = cleanServiceFields(input, { creating: true });
    const result = await db.write(async tx => {
      if (await tx.get('SELECT 1 AS x FROM services WHERE key = ?', [f.key])) throw new HttpError(409, 'A service with that id already exists');
      if (await tx.get('SELECT 1 AS x FROM services WHERE prefix = ?', [f.prefix])) throw new HttpError(409, `The ticket letter ${f.prefix} is already used`);
      const { n } = await tx.get('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM services');
      await tx.run('INSERT INTO services (key, label, prefix, allotted_seconds, enabled, sort_order) VALUES (?,?,?,?,?,?)',
        [f.key, f.label, f.prefix, f.allotted_seconds, f.enabled === 0 ? 0 : 1, f.sort_order ?? n]);
      return f.key;
    });
    await refreshServices();
    bus.emit('services_updated', {});
    return services.get(result);
  }

  async function updateService(key, input) {
    const f = cleanServiceFields({ ...input, key: undefined }, { creating: false });
    const sets = Object.keys(f);
    if (!sets.length) throw new HttpError(400, 'Nothing to update');
    await db.write(async tx => {
      if (!(await tx.get('SELECT 1 AS x FROM services WHERE key = ?', [key]))) throw new HttpError(404, 'Service not found');
      if (f.prefix && await tx.get('SELECT 1 AS x FROM services WHERE prefix = ? AND key <> ?', [f.prefix, key])) {
        throw new HttpError(409, `The ticket letter ${f.prefix} is already used`);
      }
      await tx.run(`UPDATE services SET ${sets.map(c => `${c} = ?`).join(', ')} WHERE key = ?`, [...sets.map(c => f[c]), key]);
    });
    await refreshServices();
    bus.emit('services_updated', {});
    return services.get(key);
  }

  /* --------------------------- views and metrics --------------------------- */

  async function avgSeconds(key) {
    const hit = avgCache.get(key);
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
    const svc = services.get(key);
    const allotted = svc ? svc.allotted_seconds : 600;
    const since = iso(new Date(Date.now() - 7 * 86_400_000));
    const rows = await db.all(
      `SELECT actual_seconds FROM service_log
       WHERE service = ? AND outcome IN ('served','moved') AND actual_seconds >= ? AND ended_at >= ?
       ORDER BY id DESC LIMIT 20`, [key, MIN_COUNTED_SECONDS, since]);
    let value = allotted; // not enough history yet: trust the allotment
    if (rows.length >= 3) {
      const cap = allotted * 3; // one very long visit must not skew everyone's estimate
      value = Math.round(rows.reduce((a, r) => a + Math.min(r.actual_seconds, cap), 0) / rows.length);
    }
    value = Math.max(30, value);
    avgCache.set(key, { value, at: Date.now() });
    return value;
  }

  const budgetOf = row => (row.allotted_seconds || (services.get(row.called_service) || {}).allotted_seconds || 0) + (row.extended_seconds || 0);
  const remainingOf = row => {
    if (!row.called_at) return 0;
    return Math.max(0, budgetOf(row) - Math.floor((Date.now() - Date.parse(row.called_at)) / 1000));
  };

  /** Adds position and eta_seconds to rows (an array of ticket rows), in memory. */
  async function decorate(rows) {
    const waiting = new Map();
    const called = new Map();
    for (const r of rows) {
      if (r.status === 'waiting') {
        if (!waiting.has(r.current_service)) waiting.set(r.current_service, []);
        waiting.get(r.current_service).push(r);
      } else if (r.status === 'called') called.set(r.called_service, r);
    }
    const metrics = new Map();
    for (const [svc, list] of waiting) {
      list.sort((a, b) => String(a.service_arrival || a.created_at).localeCompare(String(b.service_arrival || b.created_at)) || a.id - b.id);
      const avg = await avgSeconds(svc);
      const busy = called.get(svc);
      const head = busy ? remainingOf(busy) : 0;
      list.forEach((r, i) => metrics.set(r.id, { position: i + 1, eta_seconds: head + i * avg }));
    }
    for (const r of called.values()) metrics.set(r.id, { position: 0, eta_seconds: 0 });
    return metrics;
  }

  function toView(row, { names = false, secret = false, metrics = null } = {}) {
    const svcs = parseServices(row.services);
    const idx = Number(row.service_index || 0);
    const current = row.current_service || svcs[idx] || null;
    const view = {
      id: row.id,
      token: pad3(row.id),
      displayToken: displayToken(row.id, current),
      name: names || cfg.publicShowNames ? row.name || '' : '',
      quer_type: row.quer_type || '',
      services: svcs,
      service_index: idx,
      current_service: current,
      status: row.status,
      called_service: row.called_service || '',
      cancel_requested: !!row.cancel_requested,
      cancel_reason: row.cancel_reason || '',
      cancel_requested_at: row.cancel_requested_at || '',
      created_at: row.created_at,
      updated_at: row.updated_at,
      served_at: row.served_at || null,
      service_arrival: row.service_arrival || row.created_at,
      called_at: row.called_at || null,
      allotted_seconds: row.allotted_seconds ?? null,
      extended_seconds: row.extended_seconds || 0,
      position: null,
      eta_seconds: null,
    };
    if (metrics && metrics.has(row.id)) Object.assign(view, metrics.get(row.id));
    if (secret) view.secret = row.secret;
    return view;
  }

  async function listActive({ names = false } = {}) {
    const rows = await db.all(
      `SELECT * FROM tickets WHERE status IN ('waiting','called','hold') ORDER BY COALESCE(service_arrival, created_at), id`);
    const metrics = await decorate(rows);
    return rows.map(r => toView(r, { names, metrics }));
  }

  async function getTicketRow(id) {
    const row = await db.get('SELECT * FROM tickets WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, 'not found');
    return row;
  }

  async function ticketView(id, opts = {}) {
    const row = await getTicketRow(id);
    let metrics = null;
    if (row.status === 'waiting' || row.status === 'called') {
      const svc = row.status === 'called' ? row.called_service : row.current_service;
      const peers = await db.all(
        `SELECT * FROM tickets WHERE (status = 'waiting' AND current_service = ?) OR (status = 'called' AND called_service = ?)`, [svc, svc]);
      metrics = await decorate(peers);
    }
    return toView(row, { ...opts, metrics });
  }

  async function stats() {
    const r = await db.get(
      `SELECT SUM(status = 'waiting') AS waiting, SUM(status = 'called') AS called, SUM(status = 'hold') AS hold,
              SUM(status = 'served') AS served, SUM(status = 'served' AND served_at >= ?) AS served_today,
              SUM(cancel_requested = 1 AND status IN ('waiting','called','hold')) AS cancel_requests
       FROM tickets`, [startOfLocalDay()]);
    const n = k => Number(r[k] || 0);
    return { waiting: n('waiting'), called: n('called'), hold: n('hold'), served: n('served'), served_today: n('served_today'), cancel_requests: n('cancel_requests') };
  }

  async function snapshot() {
    const [tickets, st] = await Promise.all([listActive({ names: true }), stats()]);
    return { now: iso(), services: serviceList({ includeDisabled: true }), tickets, stats: st };
  }

  async function historyToday(limit = 200) {
    const rows = await db.all(
      `SELECT t.*, (SELECT COALESCE(SUM(actual_seconds), 0) FROM service_log l WHERE l.ticket_id = t.id) AS total_seconds
       FROM tickets t WHERE t.status = 'served' AND t.served_at >= ? ORDER BY t.served_at DESC LIMIT ?`, [startOfLocalDay(), limit]);
    return rows.map(r => ({ ...toView(r, { names: true }), total_seconds: r.total_seconds }));
  }

  /* ------------------------------ mutations ------------------------------ */

  function cleanText(v, max) {
    return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  }

  async function createTicket({ name, services: wanted, quer_type }, { staff = false } = {}) {
    if (!Array.isArray(wanted) || wanted.length === 0) throw new HttpError(400, 'Select at least one service.');
    const route = [...new Set(wanted.map(String))];
    if (route.length > 8) throw new HttpError(400, 'Too many services selected.');
    for (const key of route) {
      const svc = services.get(key);
      if (!svc || !svc.enabled) throw new HttpError(400, `Service not available: ${key}`);
    }
    const now = iso();
    const secret = crypto.randomBytes(9).toString('base64url');
    const id = await db.write(async tx => {
      const r = await tx.run(
        `INSERT INTO tickets (name, services, quer_type, status, service_index, current_service, extended_seconds,
                              created_at, updated_at, service_arrival, secret)
         VALUES (?, ?, ?, 'waiting', 0, ?, 0, ?, ?, ?, ?)`,
        [cleanText(name, 80), JSON.stringify(route), cleanText(quer_type, 40), route[0], now, now, now, secret]);
      return r.lastID;
    });
    bus.emit('created', { id, token: pad3(id), services: route, status: 'waiting', service_index: 0, current_service: route[0], created_at: now });
    return ticketView(id, { names: staff, secret: true });
  }

  function calledPayload(row, extra = {}) {
    const svc = row.called_service;
    const token = displayToken(row.id, svc);
    return {
      id: row.id,
      token: pad3(row.id),
      displayToken: token,
      service: svc,
      status: 'called',
      called_at: row.called_at,
      allotted_seconds: row.allotted_seconds,
      service_index: row.service_index,
      title: `Token ${token} called`,
      body: `Please proceed to ${(services.get(svc) || {}).label || svc}`,
      type: 'called',
      data: { id: row.id, service: svc },
      ...extra,
    };
  }

  function announceCalled(row, extra) {
    const payload = calledPayload(row, extra);
    bus.emit('called', payload);
    push.sendForTicket(row.id, payload);
    return payload;
  }

  async function callNext(service) {
    const svc = services.get(service);
    if (!svc) throw new HttpError(400, 'Unknown service');
    const row = await db.write(async tx => {
      const now = iso();
      // One atomic statement: pick the oldest waiting ticket for this service AND make sure the
      // counter is free. Two staff clicking at once can no longer call the same ticket twice.
      const rows = await tx.all(
        `UPDATE tickets
            SET status = 'called', called_service = ?, called_at = ?, allotted_seconds = ?, extended_seconds = 0, updated_at = ?
          WHERE id = (SELECT id FROM tickets WHERE status = 'waiting' AND current_service = ?
                      ORDER BY COALESCE(service_arrival, created_at), id LIMIT 1)
            AND NOT EXISTS (SELECT 1 FROM tickets WHERE status = 'called' AND called_service = ?)
        RETURNING *`, [service, now, svc.allotted_seconds, now, service, service]);
      if (rows.length) return rows[0];
      const busy = await tx.get(`SELECT id FROM tickets WHERE status = 'called' AND called_service = ?`, [service]);
      if (busy) throw new HttpError(409, 'This counter is still serving a ticket. Complete or hold it first.', { current_id: busy.id });
      return null;
    });
    if (!row) return { message: 'No waiting ticket for this service' };
    const payload = announceCalled(row);
    return { message: `Called ${payload.displayToken}`, ticket: payload };
  }

  async function serve(id, service) {
    if (!service) throw new HttpError(400, 'service required in request body');
    const out = await db.write(async tx => {
      const t = await tx.get('SELECT * FROM tickets WHERE id = ?', [id]);
      if (!t) throw new HttpError(404, 'ticket not found');
      const route = parseServices(t.services);
      const idx = Number(t.service_index || 0);
      const current = route[idx];
      if (!current) throw new HttpError(400, 'Ticket has no current service to serve');
      if (service !== current) throw new HttpError(400, 'Ticket is not currently at this service', { currentService: current });
      if (t.status !== 'called' || t.called_service !== current) throw new HttpError(400, 'Ticket is not called for this service. Press Call Next first.');

      const nowDate = new Date();
      const now = iso(nowDate);
      const calledMs = Date.parse(t.called_at || t.updated_at || now);
      const arrivedMs = Date.parse(t.service_arrival || t.created_at || now);
      const actual = Math.max(0, Math.round((nowDate - calledMs) / 1000));
      const wait = Math.max(0, Math.round((calledMs - arrivedMs) / 1000));
      const next = idx + 1;
      const moving = next < route.length;

      await tx.run(
        `INSERT INTO service_log (ticket_id, service, stage_index, arrived_at, called_at, ended_at, allotted_seconds, extended_seconds, actual_seconds, wait_seconds, outcome)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, current, idx, t.service_arrival || t.created_at, t.called_at, now, t.allotted_seconds, t.extended_seconds || 0, actual, wait, moving ? 'moved' : 'served']);

      if (moving) {
        await tx.run(
          `UPDATE tickets SET service_index = ?, current_service = ?, status = 'waiting', called_service = '', called_at = NULL,
                  allotted_seconds = NULL, extended_seconds = 0, service_arrival = ?, updated_at = ? WHERE id = ?`,
          [next, route[next], now, now, id]);
      } else {
        await tx.run(
          `UPDATE tickets SET status = 'served', called_service = '', called_at = NULL, allotted_seconds = NULL,
                  extended_seconds = 0, served_at = ?, updated_at = ? WHERE id = ?`, [now, now, id]);
      }
      return { id, current, route, next, moving, now, actual };
    });

    avgCache.delete(out.current);
    const { id: tid, current, route, next, moving, now } = out;
    if (moving) {
      const to = route[next];
      const label = (services.get(to) || {}).label || to;
      const payload = {
        id: tid, served_at: now, from: current, to, service_index: next, status: 'waiting', type: 'moved',
        title: `Moved to ${label}`, body: `Your ticket moved to ${label}`, data: { id: tid, to },
      };
      bus.emit('moved', payload);
      push.sendForTicket(tid, payload);
      return { ok: true, movedTo: to, service_index: next, actual_seconds: out.actual };
    }
    const payload = {
      id: tid, served_at: now, service: current, completed: true, status: 'served', type: 'served',
      title: 'Your ticket served', body: 'Thank you! Your ticket has been served.', data: { id: tid },
    };
    bus.emit('served', payload);
    // Notify, then forget the push subscription: it has no further use.
    push.sendForTicket(tid, payload).finally(() => db.write(tx => tx.run('DELETE FROM subscriptions WHERE ticket_id = ?', [tid])).catch(() => {}));
    return { ok: true, completed: true, actual_seconds: out.actual };
  }

  async function hold(id) {
    const now = iso();
    await db.write(async tx => {
      const t = await tx.get('SELECT status FROM tickets WHERE id = ?', [id]);
      if (!t) throw new HttpError(404, 'ticket not found');
      if (!['called', 'waiting'].includes(t.status)) throw new HttpError(400, 'Only waiting or called tickets can be put on hold');
      await tx.run(`UPDATE tickets SET status = 'hold', called_service = '', called_at = NULL, allotted_seconds = NULL, extended_seconds = 0, updated_at = ? WHERE id = ?`, [now, id]);
    });
    bus.emit('hold', { id, at: now, status: 'hold' });
    return { ok: true };
  }

  /** Shared by recall() and reassign(): put a ticket at a counter with a fresh timer. */
  async function callSpecific(tx, id, service) {
    const svc = services.get(service);
    if (!svc) throw new HttpError(400, 'Unknown service');
    const busy = await tx.get(`SELECT id FROM tickets WHERE status = 'called' AND called_service = ? AND id <> ?`, [service, id]);
    if (busy) throw new HttpError(409, 'That counter is still serving a ticket. Complete or hold it first.', { current_id: busy.id });
    const now = iso();
    const rows = await tx.all(
      `UPDATE tickets SET status = 'called', called_service = ?, called_at = ?, allotted_seconds = ?, extended_seconds = 0, updated_at = ?
       WHERE id = ? RETURNING *`, [service, now, svc.allotted_seconds, now, id]);
    return rows[0];
  }

  async function recall(id) {
    const row = await db.write(async tx => {
      const t = await tx.get('SELECT * FROM tickets WHERE id = ?', [id]);
      if (!t) throw new HttpError(404, 'ticket not found');
      if (t.status !== 'hold') throw new HttpError(400, 'Only tickets on hold can be recalled');
      const current = t.current_service || parseServices(t.services)[t.service_index || 0];
      if (!current) throw new HttpError(400, 'Ticket has no current service');
      return callSpecific(tx, id, current);
    });
    bus.emit('recalled', { id, service: row.called_service, at: row.called_at });
    announceCalled(row);
    return { ok: true };
  }

  async function reassign(id, toService) {
    if (!toService) throw new HttpError(400, 'service required');
    const row = await db.write(async tx => {
      const t = await tx.get('SELECT * FROM tickets WHERE id = ?', [id]);
      if (!t) throw new HttpError(404, 'not found');
      if (!ACTIVE.includes(t.status)) throw new HttpError(400, 'Ticket is already finished');
      const route = parseServices(t.services);
      const idx = route.indexOf(toService);
      if (idx === -1) throw new HttpError(400, 'Ticket does not include the target service');
      const now = iso();
      await tx.run(`UPDATE tickets SET service_index = ?, current_service = ?, service_arrival = ? WHERE id = ?`, [idx, toService, now, id]);
      return callSpecific(tx, id, toService);
    });
    const payload = calledPayload(row, { toService, to: toService, at: row.called_at, type: 'reassigned' });
    bus.emit('reassigned', payload);
    bus.emit('called', { ...payload, type: 'called' });
    push.sendForTicket(id, payload);
    return { ok: true, ticket: payload };
  }

  async function extend(id, seconds) {
    const add = Math.round(Number(seconds));
    if (!Number.isFinite(add) || add < 30 || add > 1800) throw new HttpError(400, 'Extra time must be between 30 seconds and 30 minutes');
    const row = await db.write(async tx => {
      const t = await tx.get('SELECT * FROM tickets WHERE id = ?', [id]);
      if (!t) throw new HttpError(404, 'ticket not found');
      if (t.status !== 'called') throw new HttpError(400, 'Only a ticket that is being served can be given extra time');
      const total = Math.min(MAX_EXTENSION_TOTAL, (t.extended_seconds || 0) + add);
      const rows = await tx.all(`UPDATE tickets SET extended_seconds = ?, updated_at = ? WHERE id = ? RETURNING *`, [total, iso(), id]);
      return rows[0];
    });
    bus.emit('extended', { id, extended_seconds: row.extended_seconds, service: row.called_service });
    return { ok: true, extended_seconds: row.extended_seconds };
  }

  async function requestCancel(id, { reason, secret }, { staff = false } = {}) {
    const text = cleanText(reason, 300);
    const now = iso();
    await db.write(async tx => {
      const t = await tx.get('SELECT * FROM tickets WHERE id = ?', [id]);
      if (!t) throw new HttpError(404, 'not found');
      if (!ACTIVE.includes(t.status)) throw new HttpError(400, 'This ticket is already finished');
      // Ticket numbers are sequential and guessable, so the ticket's private code is required.
      if (!staff && t.secret && String(secret || '') !== t.secret) throw new HttpError(403, 'Not allowed to cancel this ticket');
      // Status is left alone: a ticket being served is still being served until staff decide.
      await tx.run(`UPDATE tickets SET cancel_requested = 1, cancel_reason = ?, cancel_requested_at = ?, updated_at = ? WHERE id = ?`, [text, now, now, id]);
    });
    bus.emit('cancel_requested', { id, type: 'cancel_requested', cancel_requested: true });
    return { ok: true, ticket: { id, cancel_reason: text, cancel_requested_at: now, type: 'cancel_requested' } };
  }

  async function clearCancel(id) {
    const now = iso();
    const r = await db.write(tx => tx.run(
      `UPDATE tickets SET cancel_requested = 0, cancel_reason = '', cancel_requested_at = '', updated_at = ? WHERE id = ?`, [now, id]));
    if (!r.changes) throw new HttpError(404, 'ticket not found');
    bus.emit('cancel_cleared', { id, at: now, cancel_requested: false });
    return { ok: true };
  }

  async function remove(id) {
    const row = await db.write(async tx => {
      const t = await tx.get('SELECT * FROM tickets WHERE id = ?', [id]);
      if (!t) throw new HttpError(404, 'not found');
      await tx.run('DELETE FROM tickets WHERE id = ?', [id]);
      await tx.run('DELETE FROM subscriptions WHERE ticket_id = ?', [id]);
      return t;
    });
    bus.emit('deleted', { id, token: pad3(id), service: row.called_service || row.current_service || null });
    return { ok: true };
  }

  async function subscribe({ subscription, ticketId, secret }) {
    if (!subscription || typeof subscription.endpoint !== 'string' || !subscription.endpoint.startsWith('https://')) {
      throw new HttpError(400, 'missing subscription');
    }
    const keys = JSON.stringify(subscription.keys || {});
    let tId = null;
    if (ticketId) {
      tId = Number(ticketId);
      const t = Number.isInteger(tId) ? await db.get('SELECT secret FROM tickets WHERE id = ?', [tId]) : null;
      if (!t) throw new HttpError(404, 'ticket not found');
      if (t.secret && String(secret || '') !== t.secret) throw new HttpError(403, 'Not allowed to follow this ticket');
    }
    const r = await db.write(async tx => {
      const row = await tx.get('SELECT id FROM subscriptions WHERE endpoint = ?', [subscription.endpoint]);
      if (row) {
        await tx.run('UPDATE subscriptions SET keys = ?, ticket_id = ? WHERE id = ?', [keys, tId, row.id]);
        return row.id;
      }
      return (await tx.run('INSERT INTO subscriptions (endpoint, keys, ticket_id) VALUES (?,?,?)', [subscription.endpoint, keys, tId])).lastID;
    });
    return { ok: true, id: r };
  }

  /* ------------------------------- reporting ------------------------------- */

  function rangeStart(range) {
    if (range === '30d') return startOfLocalDay(29);
    if (range === '7d') return startOfLocalDay(6);
    return startOfLocalDay(0);
  }

  async function reports(range = 'today') {
    const since = rangeStart(range);
    const rows = await db.all(
      `SELECT service, COUNT(*) AS visits,
              ROUND(AVG(actual_seconds)) AS avg_actual, MAX(actual_seconds) AS max_actual,
              ROUND(AVG(allotted_seconds)) AS avg_allotted,
              SUM(CASE WHEN actual_seconds <= COALESCE(allotted_seconds, 0) + extended_seconds THEN 1 ELSE 0 END) AS within,
              SUM(CASE WHEN extended_seconds > 0 THEN 1 ELSE 0 END) AS extended_visits,
              ROUND(AVG(wait_seconds)) AS avg_wait,
              SUM(actual_seconds) AS sum_actual, SUM(COALESCE(wait_seconds, 0)) AS sum_wait
       FROM service_log WHERE ended_at >= ? AND actual_seconds >= ? GROUP BY service`, [since, MIN_COUNTED_SECONDS]);
    const byKey = new Map(rows.map(r => [r.service, r]));
    const perService = serviceList({ includeDisabled: true }).map(s => {
      const r = byKey.get(s.key) || {};
      const visits = Number(r.visits || 0);
      return {
        service: s.key, label: s.label, prefix: s.prefix, enabled: s.enabled,
        allotted_seconds: s.allotted_seconds,
        visits,
        avg_actual: visits ? Number(r.avg_actual) : null,
        max_actual: visits ? Number(r.max_actual) : null,
        avg_wait: visits ? Number(r.avg_wait) : null,
        within_pct: visits ? Math.round((Number(r.within) / visits) * 100) : null,
        extended_visits: Number(r.extended_visits || 0),
      };
    });
    const total = rows.reduce((a, r) => {
      a.visits += Number(r.visits); a.actual += Number(r.sum_actual); a.wait += Number(r.sum_wait); a.within += Number(r.within); return a;
    }, { visits: 0, actual: 0, wait: 0, within: 0 });
    const completed = await db.get(`SELECT COUNT(*) AS n FROM service_log WHERE ended_at >= ? AND outcome = 'served'`, [since]);
    const hourly = await db.all(
      `SELECT CAST(strftime('%H', ended_at, 'localtime') AS INTEGER) AS hour, COUNT(*) AS n
       FROM service_log WHERE ended_at >= ? AND actual_seconds >= ? GROUP BY hour ORDER BY hour`, [since, MIN_COUNTED_SECONDS]);
    const daily = await db.all(
      `SELECT strftime('%Y-%m-%d', ended_at, 'localtime') AS day, COUNT(*) AS n
       FROM service_log WHERE ended_at >= ? AND actual_seconds >= ? GROUP BY day ORDER BY day`, [since, MIN_COUNTED_SECONDS]);
    return {
      range, since,
      totals: {
        visits: total.visits,
        tickets_completed: Number(completed.n || 0),
        avg_actual: total.visits ? Math.round(total.actual / total.visits) : null,
        avg_wait: total.visits ? Math.round(total.wait / total.visits) : null,
        within_pct: total.visits ? Math.round((total.within / total.visits) * 100) : null,
      },
      per_service: perService,
      hourly: hourly.map(h => ({ hour: h.hour, count: h.n })),
      daily: daily.map(d => ({ day: d.day, count: d.n })),
    };
  }

  async function exportCsv(type = 'tickets') {
    if (type === 'stages') {
      const rows = await db.all('SELECT * FROM service_log ORDER BY id');
      const head = 'id,ticket_id,service,stage_index,arrived_at,called_at,ended_at,allotted_seconds,extended_seconds,actual_seconds,wait_seconds,outcome\n';
      return head + rows.map(r => [r.id, r.ticket_id, r.service, r.stage_index, r.arrived_at, r.called_at, r.ended_at, r.allotted_seconds, r.extended_seconds, r.actual_seconds, r.wait_seconds, r.outcome].map(csvCell).join(',')).join('\n');
    }
    const rows = await db.all('SELECT * FROM tickets ORDER BY id');
    const head = 'id,token,name,services,quer_type,status,current_service,cancel_requested,cancel_reason,created_at,updated_at,served_at\n';
    return head + rows.map(r => [r.id, pad3(r.id), r.name, r.services, r.quer_type, r.status, r.current_service, r.cancel_requested ? 1 : 0, r.cancel_reason, r.created_at, r.updated_at, r.served_at].map(csvCell).join(',')).join('\n');
  }

  /** Delete finished tickets (and the personal data on them) older than `days`. Stage timings are kept. */
  async function purge(days) {
    const n = Math.max(0, Math.floor(Number(days)));
    if (!Number.isFinite(n)) throw new HttpError(400, 'days must be a number');
    const cutoff = iso(new Date(Date.now() - n * 86_400_000));
    return db.write(async tx => {
      const t = await tx.run(`DELETE FROM tickets WHERE status = 'served' AND served_at < ?`, [cutoff]);
      const s = await tx.run('DELETE FROM subscriptions WHERE ticket_id IS NOT NULL AND ticket_id NOT IN (SELECT id FROM tickets)');
      return { tickets_removed: t.changes, subscriptions_removed: s.changes, cutoff };
    });
  }

  return {
    init: refreshServices,
    serviceList, refreshServices, createService, updateService,
    listActive, ticketView, stats, snapshot, historyToday,
    createTicket, callNext, serve, hold, recall, reassign, extend,
    requestCancel, clearCancel, remove, subscribe,
    reports, exportCsv, purge,
  };
}

module.exports = { createQueue };
