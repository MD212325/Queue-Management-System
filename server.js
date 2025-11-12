// server.js (updated)
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const PORT = process.env.PORT || 4000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'queue.db');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

const STAFF_KEY = process.env.STAFF_KEY || 'STI-QUEUE-KEY';

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

// Service prefix mapping for display tokens
const SERVICE_PREFIX = {
  registrar: 'R',
  cashier: 'C',
  admissions: 'A',
  records: 'D'
};

// Open (or create) DB
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Failed to open DB', err);
    process.exit(1);
  }
  console.log('Opened DB:', DB_FILE);
});

// Initialize DB schema (safe to run every startup)
db.serialize(() => {
  // create table with cancel columns included (if table already exists it's ignored)
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
    -- cancel request fields
    cancel_requested INTEGER DEFAULT 0,
    cancel_reason TEXT DEFAULT '',
    cancel_requested_at TEXT DEFAULT ''
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_tickets_status_arrival ON tickets (status, service_arrival)`);

  // If DB already existed without cancel columns, attempt to add them (ignore errors)
  const addCols = [
    `ALTER TABLE tickets ADD COLUMN cancel_requested INTEGER DEFAULT 0`,
    `ALTER TABLE tickets ADD COLUMN cancel_reason TEXT DEFAULT ''`,
    `ALTER TABLE tickets ADD COLUMN cancel_requested_at TEXT DEFAULT ''`
  ];
  addCols.forEach(sql => {
    db.run(sql, (err) => {
      if (err) {
        // probably column already exists; ignore
      }
    });
  });
});

// Utility: emit SSE event
function emitEvent(eventName, payload) {
  const data = JSON.stringify(payload || {});
  const msg = `event: ${eventName}\ndata: ${data}\n\n`;
  sseClients.forEach(c => {
    try {
      c.res.write(msg);
    } catch (e) {
      // ignore
    }
  });
}

// SSE endpoint
app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
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

// helper to parse services column
function parseServicesField(r) {
  try { return Array.isArray(r.services) ? r.services : JSON.parse(r.services || '[]'); }
  catch(e){ return []; }
}

// Get full queue (all tickets)
app.get('/queue', (req, res) => {
  db.all(`SELECT * FROM tickets ORDER BY id ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });

    const parsed = rows.map(r => {
      const services = parseServicesField(r);
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

// Get a single ticket (authoritative record)
app.get('/ticket/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(404).json({ error: 'not found' });

    const services = parseServicesField(row);
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

// Stats (simple)
app.get('/stats', (req, res) => {
  db.get(
    `SELECT 
       SUM(CASE WHEN status='waiting' THEN 1 ELSE 0 END) AS waiting,
       SUM(CASE WHEN status='served' THEN 1 ELSE 0 END) AS served
     FROM tickets`, [], (err, row) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ waiting: row.waiting || 0, served: row.served || 0 });
    }
  );
});

// Create ticket
app.post('/ticket', (req, res) => {
  const { name = '', services, quer_type = '' } = req.body || {};
  if (!Array.isArray(services) || services.length === 0) {
    return res.status(400).json({ error: 'Select at least one service.' });
  }

  const now = new Date().toISOString();
  const servicesJson = JSON.stringify(services);

  const stmt = `INSERT INTO tickets (name, services, quer_type, status, service_index, created_at, updated_at, service_arrival)
                VALUES (?, ?, ?, 'waiting', 0, ?, ?, ?)`;
  db.run(stmt, [name || '', servicesJson, quer_type || '', now, now, now], function(err) {
    if (err) return res.status(500).json({ error: 'DB insert error', detail: err.message });
    const id = this.lastID;
    const token = String(id).padStart(3,'0');
    const ticket = { id, token, name, services, quer_type, status: 'waiting', service_index: 0, created_at: now };
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
      const sv = parseServicesField(r);
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
          service_index: matched.service_index
        };
        emitEvent('called', payload);
        return res.json({ message: `Called ${displayToken}`, ticket: payload });
      }
    );
  });
});

// Serve current service (staff)
app.post('/serve/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const callerService = (req.body && req.body.service) ? String(req.body.service) : null;

  if (!id) return res.status(400).json({ error: 'invalid id' });
  if (!callerService) return res.status(400).json({ error: 'service required in request body' });

  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (err, ticket) => {
    if (err) {
      console.error('DB get error', err);
      return res.status(500).json({ error: 'DB error' });
    }
    if (!ticket) return res.status(404).json({ error: 'ticket not found' });

    const services = parseServicesField(ticket);
    const idx = Number(ticket.service_index || 0);
    const currentService = (Array.isArray(services) && typeof services[idx] !== 'undefined') ? services[idx] : null;

    if (!currentService) return res.status(400).json({ error: 'Ticket has no current service to serve' });

    if (callerService !== currentService) {
      return res.status(400).json({ error: 'Ticket is not currently at this service', currentService });
    }

    if (ticket.status !== 'called' || ticket.called_service !== currentService) {
      return res.status(400).json({ error: 'Ticket is not called for this service. Press Call Next first.' });
    }

    const now = new Date().toISOString();
    const nextIndex = idx + 1;

    if (Array.isArray(services) && nextIndex < services.length) {
      db.run(
        `UPDATE tickets SET service_index = ?, status = 'waiting', called_service = '', service_arrival = ?, updated_at = ? WHERE id = ?`,
        [nextIndex, now, now, id],
        function(uerr) {
          if (uerr) {
            console.error('DB update error advancing ticket', uerr);
            return res.status(500).json({ error: 'DB update error', detail: uerr.message });
          }
          const payload = { id, served_at: now, from: currentService, to: services[nextIndex], service_index: nextIndex };
          emitEvent('served', payload);
          emitEvent('moved', payload);
          return res.json({ ok: true, movedTo: services[nextIndex], service_index: nextIndex });
        }
      );
    } else {
      db.run(
        `UPDATE tickets SET status = 'served', served_at = ?, updated_at = ? WHERE id = ?`,
        [now, now, id],
        function(uerr) {
          if (uerr) {
            console.error('DB update error completing ticket', uerr);
            return res.status(500).json({ error: 'DB update error', detail: uerr.message });
          }
          emitEvent('served', { id, served_at: now, service: currentService, completed: true });
          return res.json({ ok: true, completed: true });
        }
      );
    }
  });
});

// Reassign to a different service in the current services list (staff)
app.post('/reassign/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const toService = (req.body && req.body.service) ? String(req.body.service) : null;
  if (!id) return res.status(400).json({ error: 'invalid id' });
  if (!toService) return res.status(400).json({ error: 'service required' });

  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (err, ticket) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!ticket) return res.status(404).json({ error: 'not found' });

    const services = parseServicesField(ticket);
    const idx = services.indexOf(toService);
    if (idx === -1) return res.status(400).json({ error: 'Ticket does not include the target service' });

    const now = new Date().toISOString();
    db.run(
      `UPDATE tickets SET service_index = ?, status = 'called', called_service = ?, service_arrival = ?, updated_at = ? WHERE id = ?`,
      [idx, toService, now, now, id],
      function(uerr) {
        if (uerr) return res.status(500).json({ error: 'DB update error', detail: uerr.message });
        const payload = { id, toService, service_index: idx, at: now };
        emitEvent('reassigned', payload);
        emitEvent('called', payload);
        return res.json({ ok: true, ticket: payload });
      }
    );
  });
});

// put on hold (staff)
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

// recall from hold (staff)
app.post('/recall/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (err, ticket) => {
    if (err) return res.status(500).json({ error: 'DB error', detail: err.message });
    if (!ticket) return res.status(404).json({ error: 'ticket not found' });

    const services = parseServicesField(ticket);
    const idx = Number(ticket.service_index || 0);
    const currentService = services[idx];
    if (!currentService) return res.status(400).json({ error: 'Ticket has no current service' });

    const now = new Date().toISOString();
    db.run(`UPDATE tickets SET status = 'called', called_service = ?, updated_at = ? WHERE id = ?`,
      [currentService, now, id],
      function(uerr) {
        if (uerr) return res.status(500).json({ error: 'DB update error', detail: uerr.message });
        emitEvent('recalled', { id, service: currentService, at: now });
        return res.json({ ok: true });
      });
  });
});

// Delete ticket (staff)
app.delete('/ticket/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  console.log(`[DELETE] request for ticket id=${id} from ${req.ip} headers:`, req.headers['x-staff-key'] ? 'has-key' : 'no-key');
  if (!id) return res.status(400).json({ error: 'invalid id' });
  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (e, row) => {
    if (e) { console.error('DB error', e); return res.status(500).json({ error: 'DB error' }); }
    if (!row) return res.status(404).json({ error: 'not found' });
    db.run(`DELETE FROM tickets WHERE id = ?`, [id], function (err) {
      if (err) { console.error('DB delete error', err); return res.status(500).json({ error: 'DB error' }); }
      emitEvent('deleted', { id, token: String(row.id).padStart(3, '0'), service: row.called_service || null });
      console.log(`[DELETE] ticket ${id} deleted`);
      res.json({ ok: true });
    });
  });
});

// Request cancel (public — kiosk will call this)
app.post('/ticket/:id/request_cancel', (req, res) => {
  const id = Number(req.params.id);
  const reason = (req.body && req.body.reason) ? String(req.body.reason).trim() : '';
  if (!id) return res.status(400).json({ error: 'invalid id' });
  if (!reason) {
    // allow empty reason but store note
  }
  const now = new Date().toISOString();
  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(404).json({ error: 'not found' });

    db.run(`UPDATE tickets SET cancel_requested = 1, cancel_reason = ?, cancel_requested_at = ?, status = 'cancel_requested', updated_at = ? WHERE id = ?`,
      [reason || '', now, now, id], function(uerr) {
        if (uerr) return res.status(500).json({ error: 'DB update error', detail: uerr.message });
        const payload = { id, cancel_reason: reason || '', cancel_requested_at: now };
        emitEvent('cancel_requested', payload);
        return res.json({ ok: true, ticket: payload });
      });
  });
});

// Staff clears a cancel request (staff decides not to delete)
app.post('/ticket/:id/clear_cancel', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(404).json({ error: 'not found' });

    const now = new Date().toISOString();
    // clear cancel fields and set status back to waiting (or keep previous if you prefer)
    db.run(`UPDATE tickets SET cancel_requested = 0, cancel_reason = '', cancel_requested_at = '', status = 'waiting', updated_at = ? WHERE id = ?`,
      [now, id], function(uerr) {
        if (uerr) return res.status(500).json({ error: 'DB update error', detail: uerr.message });
        emitEvent('cancel_cleared', { id, at: now });
        return res.json({ ok: true });
      });
  });
});

// Export CSV
app.get('/export.csv', (req, res) => {
  db.all('SELECT * FROM tickets ORDER BY id', [], (err, rows) => {
    if (err) return res.status(500).send('Error');
    const header = 'id,token,name,services,quer_type,called_service,status,cancel_requested,cancel_reason,created_at,updated_at,served_at\n';
    const body = rows.map(r => {
      const token = String(r.id).padStart(3, '0');
      const q = v => `"${String(v || '').replace(/"/g, '""')}"`;
      return [
        r.id,
        token,
        q(r.name),
        q(r.services),
        q(r.quer_type),
        q(r.called_service),
        q(r.status),
        Number(r.cancel_requested || 0),
        q(r.cancel_reason),
        q(r.created_at),
        q(r.updated_at),
        q(r.served_at)
      ].join(',');
    }).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tickets.csv"');
    res.send(header + body);
  });
});

// simple health endpoint
app.get('/health', (req, res) => res.json({ ok: true }));

// start listening on all interfaces
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening at http://0.0.0.0:${PORT}`);
});
