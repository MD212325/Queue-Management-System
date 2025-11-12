const sqlite3 = require('sqlite3').verbose();
const path = './queue.db';
const db = new sqlite3.Database(path);

db.serialize(() => {
  console.log('Starting migration...');

  // 1) Ensure `service` column exists in tickets
  db.get("PRAGMA table_info('tickets')", (err) => {
    // We'll try ALTER TABLE; if column already exists, an error will be thrown and we'll continue.
    db.run("ALTER TABLE tickets ADD COLUMN service TEXT DEFAULT 'registrar'", function(err2) {
      if (err2) {
        if (err2.message && err2.message.toLowerCase().includes('duplicate column')) {
          console.log('service column already exists — OK');
        } else {
          console.log('ALTER TABLE result (might be okay if column exists):', err2.message);
        }
      } else {
        console.log('Added service column to tickets table.');
      }

      // 2) Ensure counters table exists
      db.run(`CREATE TABLE IF NOT EXISTS counters (
        service TEXT PRIMARY KEY,
        last_number INTEGER DEFAULT 0
      )`, (cErr) => {
        if (cErr) {
          console.error('Error creating counters table:', cErr.message);
          return finish();
        }
        console.log('Counters table ensured.');

        // 3) Read tickets and compute max number per service (infer service from token if missing)
        db.all('SELECT id, token, service FROM tickets', [], (qErr, rows) => {
          if (qErr) {
            console.error('Error reading tickets:', qErr.message);
            return finish();
          }

          const counters = {}; // { serviceName: maxNumber }
          const prefixMap = { 'R': 'registrar', 'C': 'cashier', 'A': 'admissions', 'D': 'records' };

          rows.forEach(r => {
            let svc = r.service;
            const token = r.token || '';

            // Extract numeric suffix from token (e.g., R-0001 or R1 -> 1)
            const m = token.match(/(\d+)$/);
            const num = m ? parseInt(m[1], 10) : 0;

            if (!svc) {
              // If service missing, try infer from prefix (strip digits and dashes)
              let prefix = token.replace(/[\d\-]/g, '').trim(); // e.g. 'R' or 'R'
              if (prefix.length > 1) prefix = prefix.charAt(0); // just in case
              svc = prefixMap[prefix] || (prefix ? prefix.toLowerCase() : 'registrar');
            }

            if (!counters[svc] || counters[svc] < num) counters[svc] = num;
          });

          // 4) Upsert counters into counters table
          const stmt = db.prepare("INSERT OR REPLACE INTO counters(service, last_number) VALUES (?, ?)");
          const entries = Object.entries(counters);
          if (entries.length === 0) {
            console.log('No existing tokens to compute counters from — counters left as default 0.');
            stmt.finalize(() => finish());
            return;
          }

          entries.forEach(([svc, maxNum]) => {
            stmt.run(svc, maxNum, (runErr) => {
              if (runErr) console.error('Failed to upsert counter', svc, runErr.message);
              else console.log('Set counter for', svc, 'to', maxNum);
            });
          });

          stmt.finalize(() => finish());
        });
      });
    });
  });
});

function finish() {
  db.close(() => {
    console.log('Migration finished. Close DB.');
  });
}
