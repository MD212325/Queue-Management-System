require('dotenv').config(); // load .env if present

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const webpush = require('web-push');

const PORT = process.env.PORT || 4000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'queue.db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// staff key
const STAFF_KEY = process.env.STAFF_KEY || 'STI-QUEUE-KEY';

// VAPID keys & subject: set these env vars before running or use .env
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || null;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || null;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || null;

// safe logging to check if env vars are loaded in this process
function mask(s, keep = 8) {
  if (!s) return '(missing)';
  return s.length <= keep ? '***' : s.slice(0, keep) + '...';
}
console.log('VAPID public:', mask(VAPID_PUBLIC));
console.log('VAPID private:', VAPID_PRIVATE ? `<hidden, length ${VAPID_PRIVATE.length}>` : '(missing)');
console.log('VAPID subject:', VAPID_SUBJECT || '(missing)');

if (VAPID_PUBLIC && VAPID_PRIVATE && VAPID_SUBJECT) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    console.log('web-push: VAPID keys loaded and subject validated.');
  } catch (e) {
    console.error('Failed to set VAPID details:', e && e.message);
  }
} else {
  console.warn('web-push VAPID keys or subject missing. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT env variables (or .env).');
}

// Middleware to protect staff routes
function requireStaff(req, res, next) {
  const key = req.headers['x-staff-key'] || req.query.staff_key;
  if (!key || key !== STAFF_KEY) {
    return res.status(401).json({ error: 'Unauthorized: staff credentials required' });
  }
  next();
}

// SSE clients storage
const sseClients = [];

// service prefix mapping for display tokens
const SERVICE_PREFIX = {
  registrar: 'R',
  cashier: 'C',
  admissions: 'A',
  records: 'D'
};

// open/create DB
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Failed to open DB', err);
    process.exit(1);
  }
  console.log('Opened DB:', DB_FILE);
});

// initialize DB schema
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    services TEXT NOT NULL DEFAULT '[]',
    quer_type TEXT,
    status TEXT NOT NULL DEFAULT 'waiting',
    called_service TEXT DEFAULT '',
    service_index INTEGER DEFAULT 0,
    service_arrival TEXT,
    created_at TEXT,
    updated_at TEXT,
    served_at TEXT,
    cancel_requested INTEGER DEFAULT 0,
    cancel_reason TEXT DEFAULT '',
    cancel_requested_at TEXT DEFAULT ''
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tickets_status_arrival ON tickets (status, service_arrival)`);

  db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL UNIQUE,
    keys TEXT,
    ticket_id INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
});

/* SSE emitter helper */
function emitEvent(eventName, payload) {
  const data = JSON.stringify(payload || {});
  const msg = `event: ${eventName}\ndata: ${data}\n\n`;
  sseClients.forEach(c => {
    try { c.res.write(msg); } catch(e) {}
  });
}

/* push helpers */
async function sendPushNotificationToRow(subRow, payloadObj) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn('VAPID keys not configured; skipping push send');
    return;
  }
  try {
    const subscription = { endpoint: subRow.endpoint, keys: JSON.parse(subRow.keys || '{}') };
    await webpush.sendNotification(subscription, JSON.stringify(payloadObj));
  } catch (err) {
    console.warn('web-push send error', err && err.statusCode, err && err.body);
    if (err && (err.statusCode === 410 || err.statusCode === 404)) {
      db.run('DELETE FROM subscriptions WHERE id = ?', [subRow.id], (e) => {
        if (e) console.warn('failed delete stale subscription', e);
      });
    }
  }
}

function sendPushForTicket(ticketId, payload) {
  db.all('SELECT * FROM subscriptions WHERE ticket_id = ?', [ticketId], (err, rows) => {
    if (err) { console.warn('push lookup error', err); return; }
    rows.forEach(row => sendPushNotificationToRow(row, payload));
  });
}

/* ------------------- endpoints ------------------- */

// SSE
app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders && res.flushHeaders();
  res.write(':ok\n\n');

  const clientId = Date.now() + Math.random();
  const client = { id: clientId, res };
  sseClients.push(client);
  console.log('SSE client connected:', clientId, 'total:', sseClients.length);

  req.on('close', () => {
    const idx = sseClients.findIndex(c => c.id === clientId);
    if (idx !== -1) sseClients.splice(idx, 1);
    console.log('SSE client disconnected:', clientId, 'remaining:', sseClients.length);
  });
});

// get queue
app.get('/queue', (req, res) => {
  db.all(`SELECT * FROM tickets ORDER BY id ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    const parsed = rows.map(r => {
      let services = [];
      try { services = Array.isArray(r.services) ? r.services : JSON.parse(r.services || '[]'); } catch(e){ services = []; }
      const idx = Number(r.service_index || 0);
      const current_service = (services && services[idx]) ? services[idx] : null;
      const tokenNumeric = String(r.id).padStart(3, '0');
      const prefix = SERVICE_PREFIX[current_service] || '';
      const displayToken = prefix + tokenNumeric;
      return {
        ...r,
        services,
        current_service,
        token: tokenNumeric,
        displayToken,
        cancel_requested: Boolean(Number(r.cancel_requested || 0)),
        cancel_reason: r.cancel_reason || '',
        cancel_requested_at: r.cancel_requested_at || ''
      };
    });
    res.json(parsed);
  });
});

// get ticket
app.get('/ticket/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(404).json({ error: 'not found' });
    let services = [];
    try { services = Array.isArray(row.services) ? row.services : JSON.parse(row.services || '[]'); } catch(e){ services = []; }
    const idx = Number(row.service_index || 0);
    const current_service = (services && services[idx]) ? services[idx] : null;
    const tokenNumeric = String(row.id).padStart(3, '0');
    const prefix = SERVICE_PREFIX[current_service] || '';
    const displayToken = prefix + tokenNumeric;
    res.json({
      ...row,
      services,
      current_service,
      token: tokenNumeric,
      displayToken,
      cancel_requested: Boolean(Number(row.cancel_requested || 0)),
      cancel_reason: row.cancel_reason || '',
      cancel_requested_at: row.cancel_requested_at || ''
    });
  });
});

// stats
app.get('/stats', (req,res) => {
  db.get(`SELECT SUM(CASE WHEN status='waiting' THEN 1 ELSE 0 END) AS waiting, SUM(CASE WHEN status='served' THEN 1 ELSE 0 END) AS served FROM tickets`, [], (err,row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ waiting: row.waiting || 0, served: row.served || 0 });
  });
});

// create ticket
app.post('/ticket', (req, res) => {
  const { name = '', services, quer_type = '' } = req.body || {};
  if (!Array.isArray(services) || services.length === 0) return res.status(400).json({ error: 'Select at least one service.' });
  const now = new Date().toISOString();
  const servicesJson = JSON.stringify(services);
  const stmt = `INSERT INTO tickets (name, services, quer_type, status, service_index, created_at, updated_at, service_arrival)
                VALUES (?, ?, ?, 'waiting', 0, ?, ?, ?)`;
  db.run(stmt, [name || '', servicesJson, quer_type || '', now, now, now], function(err) {
    if (err) return res.status(500).json({ error: 'DB insert error', detail: err.message });
    const id = this.lastID;
    const ticket = { id, token: String(id).padStart(3,'0'), name, services, quer_type, status: 'waiting', service_index: 0, created_at: now };
    emitEvent('created', ticket);
    return res.json(ticket);
  });
});

// call next (staff)
app.post('/next', requireStaff, (req, res) => {
  const { service } = req.body || {};
  if (!service) return res.status(400).json({ error: 'service required' });

  db.all(`SELECT * FROM tickets WHERE status = 'waiting' ORDER BY COALESCE(service_arrival, created_at) ASC, id ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error', detail: err.message });

    let matched = null;
    for (const r of rows) {
      let sv = [];
      try { sv = Array.isArray(r.services) ? r.services : JSON.parse(r.services || '[]'); } catch(e) { sv = []; }
      const idx = Number(r.service_index || 0);
      if (Array.isArray(sv) && sv[idx] === service) { matched = r; break; }
    }

    if (!matched) return res.json({ message: 'No waiting ticket for this service' });

    const now = new Date().toISOString();
    db.run(
      `UPDATE tickets SET status = 'called', called_service = ?, updated_at = ? WHERE id = ?`,
      [service, now, matched.id],
      function(uerr) {
        if (uerr) return res.status(500).json({ error: 'DB update error', detail: uerr.message });
        const tokenNumeric = String(matched.id).padStart(3,'0');
        const displayToken = (SERVICE_PREFIX[service] || service[0].toUpperCase()) + tokenNumeric;
        const payload = {
          id: matched.id,
          token: tokenNumeric,
          displayToken,
          service,
          quer_type: matched.quer_type,
          name: matched.name,
          status: 'called',
          called_at: now,
          service_index: matched.service_index,
          title: `Token ${displayToken} called`,
          body: `Please proceed to ${service}`,
          type: 'called',
          data: { id: matched.id, service }
        };
        emitEvent('called', payload);

        try { sendPushForTicket(matched.id, payload); } catch(e){ console.warn('sendPushForTicket error', e); }

        return res.json({ message: `Called ${displayToken}`, ticket: payload });
      }
    );
  });
});

// serve current service (staff)
app.post('/serve/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const callerService = (req.body && req.body.service) ? String(req.body.service) : null;
  if (!id) return res.status(400).json({ error: 'invalid id' });
  if (!callerService) return res.status(400).json({ error: 'service required in request body' });

  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (err, ticket) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!ticket) return res.status(404).json({ error: 'ticket not found' });

    let services = [];
    try { services = Array.isArray(ticket.services) ? ticket.services : JSON.parse(ticket.services || '[]'); } catch (e) { services = []; }
    const idx = Number(ticket.service_index || 0);
    const currentService = (Array.isArray(services) && typeof services[idx] !== 'undefined') ? services[idx] : null;

    if (!currentService) return res.status(400).json({ error: 'Ticket has no current service to serve' });
    if (callerService !== currentService) return res.status(400).json({ error: 'Ticket is not currently at this service', currentService });
    if (ticket.status !== 'called' || ticket.called_service !== currentService) return res.status(400).json({ error: 'Ticket is not called for this service. Press Call Next first.' });

    const now = new Date().toISOString();
    const nextIndex = idx + 1;

    if (Array.isArray(services) && nextIndex < services.length) {
      // INTERMEDIATE: move to next service (do NOT emit final 'served' event)
      db.run(`UPDATE tickets SET service_index = ?, status = 'waiting', called_service = '', service_arrival = ?, updated_at = ? WHERE id = ?`, [nextIndex, now, now, id], function(uerr) {
        if (uerr) return res.status(500).json({ error: 'DB update error', detail: uerr.message });
        const payload = {
          id,
          served_at: now,
          from: currentService,
          to: services[nextIndex],
          service_index: nextIndex,
          status: 'waiting',
          type: 'moved',
          title: `Moved to ${services[nextIndex]}`,
          body: `Your ticket moved to ${services[nextIndex]}`,
          data: { id, to: services[nextIndex] }
        };
        // ONLY emit 'moved' for intermediate transitions. (Client will advance the ticket)
        emitEvent('moved', payload);

        try { sendPushForTicket(id, payload); } catch(e){}

        return res.json({ ok: true, movedTo: services[nextIndex], service_index: nextIndex });
      });
    } else {
      // FINAL: mark served and emit final 'served' event
      db.run(`UPDATE tickets SET status = 'served', served_at = ?, updated_at = ? WHERE id = ?`, [now, now, id], function(uerr) {
        if (uerr) return res.status(500).json({ error: 'DB update error', detail: uerr.message });
        const payload = {
          id,
          served_at: now,
          service: currentService,
          completed: true,
          status: 'served',
          type: 'served',
          title: 'Your ticket served',
          body: 'Thank you! Your ticket has been served.',
          data: { id }
        };
        emitEvent('served', payload);

        try { sendPushForTicket(id, payload); } catch(e){}

        return res.json({ ok: true, completed: true });
      });
    }
  });
});

// reassign (staff)
app.post('/reassign/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const toService = (req.body && req.body.service) ? String(req.body.service) : null;
  if (!id) return res.status(400).json({ error: 'invalid id' });
  if (!toService) return res.status(400).json({ error: 'service required' });

  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (err, ticket) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!ticket) return res.status(404).json({ error: 'not found' });

    let services = [];
    try { services = Array.isArray(ticket.services) ? ticket.services : JSON.parse(ticket.services || '[]'); } catch(e) { services = []; }
    const idx = services.indexOf(toService);
    if (idx === -1) return res.status(400).json({ error: 'Ticket does not include the target service' });

    const now = new Date().toISOString();
    db.run(`UPDATE tickets SET service_index = ?, status = 'called', called_service = ?, service_arrival = ?, updated_at = ? WHERE id = ?`, [idx, toService, now, now, id], function(uerr) {
      if (uerr) return res.status(500).json({ error: 'DB update error', detail: uerr.message });
      const payload = { id, toService, service_index: idx, at: now, type: 'reassigned', title: `Token ${String(id).padStart(3,'0')} called`, body: `Please proceed to ${toService}`, data: { id, toService } };
      emitEvent('reassigned', payload);
      emitEvent('called', payload);

      try { sendPushForTicket(id, payload); } catch(e){}

      return res.json({ ok: true, ticket: payload });
    });
  });
});

// hold/recall
app.post('/hold/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const now = new Date().toISOString();
  db.run(`UPDATE tickets SET status = 'hold', called_service = '', updated_at = ? WHERE id = ?`, [now, id], function(err) {
    if (err) return res.status(500).json({ error: 'DB error', detail: err.message });
    emitEvent('hold', { id, at: now });
    return res.json({ ok: true });
  });
});
app.post('/recall/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (err, ticket) => {
    if (err) return res.status(500).json({ error: 'DB error', detail: err.message });
    if (!ticket) return res.status(404).json({ error: 'ticket not found' });
    let services = [];
    try { services = Array.isArray(ticket.services) ? ticket.services : JSON.parse(ticket.services || '[]'); } catch(e) { services = []; }
    const idx = Number(ticket.service_index || 0);
    const currentService = services[idx];
    if (!currentService) return res.status(400).json({ error: 'Ticket has no current service' });
    const now = new Date().toISOString();
    db.run(`UPDATE tickets SET status = 'called', called_service = ?, updated_at = ? WHERE id = ?`, [currentService, now, id], function(uerr) {
      if (uerr) return res.status(500).json({ error: 'DB update error', detail: uerr.message });
      emitEvent('recalled', { id, service: currentService, at: now });
      return res.json({ ok: true });
    });
  });
});

// delete ticket (staff)
app.delete('/ticket/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (e, row) => {
    if (e) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(404).json({ error: 'not found' });
    db.run(`DELETE FROM tickets WHERE id = ?`, [id], function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      emitEvent('deleted', { id, token: String(row.id).padStart(3, '0'), service: row.called_service || null });
      return res.json({ ok: true });
    });
  });
});

// request cancel (public)
app.post('/ticket/:id/request_cancel', (req, res) => {
  const id = Number(req.params.id);
  const reason = (req.body && req.body.reason) ? String(req.body.reason).trim() : '';
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const now = new Date().toISOString();
  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(404).json({ error: 'not found' });
    db.run(`UPDATE tickets SET cancel_requested = 1, cancel_reason = ?, cancel_requested_at = ?, status = 'cancel_requested', updated_at = ? WHERE id = ?`, [reason || '', now, now, id], function(uerr) {
      if (uerr) return res.status(500).json({ error: 'DB update error', detail: uerr.message });
      const payload = { id, cancel_reason: reason || '', cancel_requested_at: now, type: 'cancel_requested' };
      emitEvent('cancel_requested', payload);
      return res.json({ ok: true, ticket: payload });
    });
  });
});

// staff clears cancel
app.post('/ticket/:id/clear_cancel', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const now = new Date().toISOString();
  db.run(`UPDATE tickets SET cancel_requested = 0, cancel_reason = '', cancel_requested_at = '', status = 'waiting', updated_at = ? WHERE id = ?`, [now, id], function(uerr) {
    if (uerr) return res.status(500).json({ error: 'DB update error', detail: uerr.message });
    emitEvent('cancel_cleared', { id, at: now });
    return res.json({ ok: true });
  });
});

// subscribe endpoint (store subscription; accepts optional ticketId)
app.post('/subscribe', (req, res) => {
  const { subscription, ticketId } = req.body || {};
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'missing subscription' });
  const endpoint = String(subscription.endpoint);
  const keys = JSON.stringify(subscription.keys || {});
  const tId = ticketId ? Number(ticketId) : null;

  db.get('SELECT id FROM subscriptions WHERE endpoint = ?', [endpoint], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (row) {
      db.run('UPDATE subscriptions SET keys = ?, ticket_id = ? WHERE id = ?', [keys, tId, row.id], (uerr) => {
        if (uerr) return res.status(500).json({ error: 'DB update error' });
        return res.json({ ok: true, id: row.id });
      });
    } else {
      db.run('INSERT INTO subscriptions (endpoint, keys, ticket_id) VALUES (?, ?, ?)', [endpoint, keys, tId], function(ierr) {
        if (ierr) return res.status(500).json({ error: 'DB insert error' });
        return res.json({ ok: true, id: this.lastID });
      });
    }
  });
});

// export CSV
app.get('/export.csv', (req, res) => {
  db.all('SELECT * FROM tickets ORDER BY id', [], (err, rows) => {
    if (err) return res.status(500).send('Error');
    const header = 'id,token,name,services,quer_type,called_service,status,cancel_requested,cancel_reason,created_at,updated_at,served_at\n';
    const body = rows.map(r => {
      const token = String(r.id).padStart(3,'0');
      const q = v => `"${String(v || '').replace(/"/g, '""')}"`;
      return [
        r.id, token, q(r.name), q(r.services), q(r.quer_type), q(r.called_service),
        q(r.status), Number(r.cancel_requested || 0), q(r.cancel_reason), q(r.created_at), q(r.updated_at), q(r.served_at)
      ].join(',');
    }).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tickets.csv"');
    res.send(header + body);
  });
});

// health
app.get('/health', (req, res) => res.json({ ok: true }));

// start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening at http://0.0.0.0:${PORT}`);
});
