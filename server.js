const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');

const DB_FILE = './queue.db';
const app = express();
app.use(cors());
app.use(bodyParser.json());

// create DB if not exists
const db = new sqlite3.Database(DB_FILE);

// Ensure tables and columns exist
db.serialize(() => {
  // tickets table with a 'service' column
  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT,
    name TEXT,
    service TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // counters table to keep per-service sequence
  db.run(`CREATE TABLE IF NOT EXISTS counters (
    service TEXT PRIMARY KEY,
    last_number INTEGER DEFAULT 0
  )`);
});

// Simple in-memory list of SSE clients
let sseClients = [];
function sendSSE(event, data){
  const payload = `event: ${event}
data: ${JSON.stringify(data)}

`;
  sseClients.forEach(client => client.res.write(payload));
}

app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();
  const id = Date.now();
  sseClients.push({id, res});
  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== id);
  });
});

// Helper: get queue
app.get('/queue', (req, res) => {
  db.all('SELECT * FROM tickets ORDER BY id', [], (err, rows) => {
    if(err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// Map service names to prefixes (fallback to first letter uppercase)
const DEFAULT_PREFIX_MAP = {
  registrar: 'R',
  cashier: 'C',
  admissions: 'A',
  records: 'D'
};

function getPrefixForService(service){
  if(!service) return 'R';
  const key = String(service).toLowerCase();
  if(DEFAULT_PREFIX_MAP[key]) return DEFAULT_PREFIX_MAP[key];
  return String(service).charAt(0).toUpperCase();
}

// Create ticket (supports service param) - improved with logging and explicit response
app.post('/ticket', (req, res) => {
  const { name, service } = req.body || {};
  const svc = service ? String(service).toLowerCase() : 'registrar';
  const prefix = getPrefixForService(svc);

  // increment counter atomically: read current, then update
  db.serialize(() => {
    db.get('SELECT last_number FROM counters WHERE service = ?', [svc], (err, row) => {
      if(err) {
        console.error('[TICKET] counters select error:', err);
        return res.status(500).json({ error: err.message });
      }
      const last = row ? row.last_number : 0;
      const next = last + 1;

      // upsert the counter
      const upsert = `INSERT INTO counters(service, last_number) VALUES(?, ?) ON CONFLICT(service) DO UPDATE SET last_number=excluded.last_number`;
      db.run(upsert, [svc, next], function(upErr) {
        if(upErr) {
          console.error('[TICKET] counters upsert error:', upErr);
          return res.status(500).json({ error: upErr.message });
        }

        const token = `${prefix}${next}`; // example: C1, R1
        db.run('INSERT INTO tickets (token, name, service, status) VALUES (?, ?, ?, ?)', [token, name || null, svc, 'waiting'], function(insErr) {
          if(insErr) {
            console.error('[TICKET] insert error:', insErr);
            return res.status(500).json({ error: insErr.message });
          }
          const id = this.lastID;
          db.get('SELECT * FROM tickets WHERE id = ?', [id], (e, row2) => {
            if(e) {
              console.error('[TICKET] select after insert error:', e);
              return res.status(500).json({ error: e.message });
            }
            // ensure a clean, explicit JSON response with expected keys
            const response = {
              id: row2.id,
              token: row2.token,
              name: row2.name,
              service: row2.service,
              status: row2.status,
              created_at: row2.created_at
            };
            console.log('[TICKET] created', response);
            sendSSE('created', response);
            res.json(response);
          });
        });
      });
    });
  });
});

// Call next (staff action) - optionally can supply service to call next for that service
app.post('/next', (req, res) => {
  const service = req.body && req.body.service ? String(req.body.service).toLowerCase() : null;
  const where = service ? `WHERE status = 'waiting' AND service = '${service}'` : "WHERE status = 'waiting'";
  db.get(`SELECT * FROM tickets ${where} ORDER BY id LIMIT 1`, [], (err, row) => {
    if(err) return res.status(500).json({error: err.message});
    if(!row) return res.status(200).json({message: 'No waiting tickets'});
    db.run("UPDATE tickets SET status = 'called', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [row.id], function(uerr) {
      db.get('SELECT * FROM tickets WHERE id = ?', [row.id], (e, r) => {
        sendSSE('called', r);
        res.json(r);
      });
    });
  });
});

// Hold a ticket
app.post('/hold/:id', (req, res) => {
  const id = req.params.id;
  db.run("UPDATE tickets SET status = 'hold', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id], function(err) {
    if(err) return res.status(500).json({error: err.message});
    db.get('SELECT * FROM tickets WHERE id = ?', [id], (e, r) => { sendSSE('hold', r); res.json(r); });
  });
});

// Recall a ticket (set back to called)
app.post('/recall/:id', (req, res) => {
  const id = req.params.id;
  db.run("UPDATE tickets SET status = 'called', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id], function(err) {
    if(err) return res.status(500).json({error: err.message});
    db.get('SELECT * FROM tickets WHERE id = ?', [id], (e, r) => { sendSSE('recalled', r); res.json(r); });
  });
});

// Serve (mark as served)
app.post('/serve/:id', (req, res) => {
  const id = req.params.id;
  db.run("UPDATE tickets SET status = 'served', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id], function(err) {
    if(err) return res.status(500).json({error: err.message});
    db.get('SELECT * FROM tickets WHERE id = ?', [id], (e, r) => { sendSSE('served', r); res.json(r); });
  });
});

// Delete a ticket by id
app.delete('/ticket/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM tickets WHERE id = ?', [id], (err, row) => {
    if(err) return res.status(500).json({error: err.message});
    if(!row) return res.status(404).json({error: 'Ticket not found'});
    db.run('DELETE FROM tickets WHERE id = ?', [id], function(dErr) {
      if(dErr) return res.status(500).json({error: dErr.message});
      sendSSE('deleted', row);
      res.json({deleted: true, ticket: row});
    });
  });
});

// Delete a ticket by token (alternative)
app.delete('/ticket/token/:token', (req, res) => {
  const token = req.params.token;
  db.get('SELECT * FROM tickets WHERE token = ?', [token], (err, row) => {
    if(err) return res.status(500).json({error: err.message});
    if(!row) return res.status(404).json({error: 'Ticket not found'});
    db.run('DELETE FROM tickets WHERE token = ?', [token], function(dErr) {
      if(dErr) return res.status(500).json({error: dErr.message});
      sendSSE('deleted', row);
      res.json({deleted: true, ticket: row});
    });
  });
});

// Stats
app.get('/stats', (req, res) => {
  db.serialize(() => {
    db.get("SELECT COUNT(*) as waiting FROM tickets WHERE status='waiting'", [], (e1, w) => {
      db.get("SELECT COUNT(*) as served FROM tickets WHERE status='served'", [], (e2, s) => {
        res.json({waiting: w.waiting || 0, served: s.served || 0});
      });
    });
  });
});

// CSV export
app.get('/export.csv', (req, res) => {
  db.all('SELECT * FROM tickets ORDER BY id', [], (err, rows) => {
    if (err) return res.status(500).send('Error');
    const header = 'id,token,name,service,status,created_at,updated_at\n';
    const body = rows
      .map(r => `${r.id},${r.token},${r.name || ''},${r.service || ''},${r.status},${r.created_at},${r.updated_at}`)
      .join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.send(header + body);
  });
});

// JSON 404 handler (must go after all routes)
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler (must be last middleware)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  res.status(err && err.status ? err.status : 500).json({ error: err && err.message ? err.message : 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log('Server listening on', PORT));