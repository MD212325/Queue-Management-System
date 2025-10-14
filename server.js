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
  db.run(
    `CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      services TEXT DEFAULT '[]',     -- JSON array of services
      quer_type TEXT DEFAULT '',
      called_service TEXT DEFAULT '',
      status TEXT DEFAULT 'waiting',  -- waiting, called, served, hold
      created_at TEXT,
      updated_at TEXT,
      served_at TEXT
    )`
  , (err) => {
    if (err) console.error('Create table error', err);
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
  // Set headers for SSE
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders && res.flushHeaders();

  // Send a small comment to keep connection alive in some proxies
  res.write(':ok\n\n');

  const clientId = Date.now() + Math.random();
  const client = { id: clientId, res };
  sseClients.push(client);
  console.log('SSE client connected:', clientId, 'total:', sseClients.length);

  // Remove client on close
  req.on('close', () => {
    const idx = sseClients.findIndex(c => c.id === clientId);
    if (idx !== -1) sseClients.splice(idx, 1);
    console.log('SSE client disconnected:', clientId, 'remaining:', sseClients.length);
  });
});

// Get full queue (all tickets)
app.get('/queue', (req, res) => {
  db.all(`SELECT * FROM tickets ORDER BY id ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    // parse services field for convenience
    const parsed = rows.map(r => {
      try { r.services = JSON.parse(r.services || '[]'); } catch(e) { r.services = []; }
      return r;
    });
    res.json(parsed);
  });
});

// Stats (simple)
app.get('/stats', (req, res) => {
  db.get(
    `SELECT 
       SUM(CASE WHEN status='waiting' THEN 1 ELSE 0 END) AS waiting,
       SUM(CASE WHEN status='served' THEN 1 ELSE 0 END) AS served
     FROM tickets`, [],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ waiting: row.waiting || 0, served: row.served || 0 });
    }
  );
});

// Create ticket
app.post('/ticket', (req, res) => {
  try {
    const { name, services, quer_type } = req.body;
    if (!Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ error: 'Select at least one service.' });
    }
    const now = new Date().toISOString();
    const servicesJson = JSON.stringify(services);
    db.run(
      `INSERT INTO tickets (name, services, quer_type, status, created_at, updated_at) VALUES (?, ?, ?, 'waiting', ?, ?)`,
      [name || '', servicesJson, quer_type || '', now, now],
      function (err) {
        if (err) return res.status(500).json({ error: 'DB insert error' });
        const id = this.lastID;
        const token = String(id).padStart(3, '0');
        const resp = { id, token, services, quer_type: quer_type || '', name: name || '', status: 'waiting', created_at: now };
        emitEvent('created', resp);
        return res.json(resp);
      }
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Call next for a specific service
app.post('/next', requireStaff, (req, res) => {
  const { service } = req.body || {};
  if (!service) return res.status(400).json({ error: 'service required' });

  // Find earliest waiting ticket that includes this service
  db.all(`SELECT * FROM tickets WHERE status = 'waiting' ORDER BY id ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    let matched = null;
    for (const r of rows) {
      let sv = [];
      try { sv = JSON.parse(r.services || '[]'); } catch(e) { sv = []; }
      if (Array.isArray(sv) && sv.includes(service)) {
        matched = r;
        break;
      }
    }
    if (!matched) return res.json({ message: 'No waiting ticket for this service' });

    const calledAt = new Date().toISOString();
    db.run(
      `UPDATE tickets SET status = 'called', called_service = ?, updated_at = ? WHERE id = ?`,
      [service, calledAt, matched.id],
      function (err2) {
        if (err2) return res.status(500).json({ error: 'DB update error' });
        const tokenNumeric = String(matched.id).padStart(3, '0');
        const prefix = SERVICE_PREFIX[service] || '';
        const displayToken = prefix + tokenNumeric;
        const payload = {
          id: matched.id,
          token: tokenNumeric,
          displayToken,
          service,
          quer_type: matched.quer_type,
          name: matched.name,
          status: 'called',
          called_at: calledAt
        };
        emitEvent('called', payload);
        return res.json({ message: `Called ${displayToken}`, ticket: payload });
      }
    );
  });
});

// Serve a ticket (mark served)
app.post('/serve/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const now = new Date().toISOString();
  db.run(
    `UPDATE tickets SET status = 'served', served_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, id],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      emitEvent('served', { id, status: 'served', served_at: now });
      res.json({ ok: true });
    }
  );
});

// Put a ticket on hold
app.post('/hold/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const now = new Date().toISOString();
  db.run(
    `UPDATE tickets SET status = 'hold', updated_at = ? WHERE id = ?`,
    [now, id],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      emitEvent('served', { id, status: 'served', served_at: now });
      res.json({ ok: true });
    }
  );
});

// Recall a held ticket (return to waiting or called depending on use case)
// Here we set it back to waiting
app.post('/recall/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const now = new Date().toISOString();
  db.run(
    `UPDATE tickets SET status = 'waiting', updated_at = ? WHERE id = ?`,
    [now, id],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      emitEvent('served', { id, status: 'served', served_at: now });
      res.json({ ok: true });
    }
  );
});

// Delete ticket
app.delete('/ticket/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (e, row) => {
    if (e) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(404).json({ error: 'not found' });
    db.run(`DELETE FROM tickets WHERE id = ?`, [id], function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      emitEvent('deleted', { id, token: String(row.id).padStart(3, '0'), service: row.called_service || null });
      res.json({ ok: true });
    });
  });
});

// Export CSV
app.get('/export.csv', (req, res) => {
  db.all('SELECT * FROM tickets ORDER BY id', [], (err, rows) => {
    if (err) return res.status(500).send('Error');
    // header must be a single JS string line (no literal newline)
    const header = 'id,token,name,services,quer_type,called_service,status,created_at,updated_at,served_at\n';
    const body = rows.map(r => {
      const token = String(r.id).padStart(3, '0');
      // quote values for CSV safety
      const q = v => `"${String(v || '').replace(/"/g, '""')}"`;
      return [
        r.id,
        token,
        q(r.name),
        q(r.services),
        q(r.quer_type),
        q(r.called_service),
        q(r.status),
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

// start listening on all interfaces so phones can reach it
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening at http://0.0.0.0:${PORT}`);
});
