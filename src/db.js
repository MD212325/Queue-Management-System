'use strict';
/**
 * Thin promise wrapper around `sqlite3` plus a schema migration runner.
 *
 * Why write() exists: the sqlite3 package uses ONE connection. If two requests each ran
 * BEGIN/COMMIT on it concurrently, their statements would interleave inside a single
 * transaction and a rollback in one request would silently undo the other's work.
 * write() puts every mutation through a queue so exactly one transaction is open at a time.
 */
const sqlite3 = require('sqlite3');

class DB {
  constructor(raw) {
    this.raw = raw;
    this._tail = Promise.resolve();
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.raw.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }
  get(sql, params = []) {
    return new Promise((resolve, reject) => this.raw.get(sql, params, (e, row) => (e ? reject(e) : resolve(row))));
  }
  all(sql, params = []) {
    return new Promise((resolve, reject) => this.raw.all(sql, params, (e, rows) => (e ? reject(e) : resolve(rows))));
  }
  exec(sql) {
    return new Promise((resolve, reject) => this.raw.exec(sql, e => (e ? reject(e) : resolve())));
  }

  /** Run fn(tx) inside BEGIN IMMEDIATE ... COMMIT, one writer at a time. */
  write(fn) {
    const job = this._tail.then(async () => {
      await this.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(this);
        await this.exec('COMMIT');
        return out;
      } catch (err) {
        await this.exec('ROLLBACK').catch(() => {});
        throw err;
      }
    });
    this._tail = job.catch(() => {});
    return job;
  }

  close() {
    return this._tail.then(() => new Promise(resolve => this.raw.close(() => resolve())));
  }
}

function open(file) {
  return new Promise((resolve, reject) => {
    const raw = new sqlite3.Database(file, async err => {
      if (err) return reject(err);
      const db = new DB(raw);
      try {
        if (raw.configure) raw.configure('busyTimeout', 5000);
        await db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
        resolve(db);
      } catch (e) { reject(e); }
    });
  });
}

/* ------------------------------ migrations ------------------------------ */

async function columns(db, table) {
  return (await db.all(`PRAGMA table_info(${table})`)).map(c => c.name);
}
async function addColumn(db, table, name, ddl) {
  if (!(await columns(db, table)).includes(name)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}

const SEED_SERVICES = [
  // key, label, prefix, allotted minutes. These match the original hard-coded services.
  ['registrar', 'Registrar', 'R', 10],
  ['cashier', 'Cashier', 'C', 5],
  ['admissions', 'Admissions', 'A', 15],
  ['records', 'Records', 'D', 10],
];

const MIGRATIONS = [
  // v1: the original schema, so databases created by the old server.js upgrade cleanly.
  async db => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
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
      );
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint TEXT NOT NULL UNIQUE,
        keys TEXT,
        ticket_id INTEGER DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );`);
  },

  // v2: time allotment, data-driven services, per-stage log, ticket secrets.
  async db => {
    await addColumn(db, 'tickets', 'current_service', 'TEXT');
    await addColumn(db, 'tickets', 'called_at', 'TEXT');
    await addColumn(db, 'tickets', 'allotted_seconds', 'INTEGER');
    await addColumn(db, 'tickets', 'extended_seconds', 'INTEGER NOT NULL DEFAULT 0');
    await addColumn(db, 'tickets', 'secret', 'TEXT');

    await db.exec(`
      CREATE TABLE IF NOT EXISTS services (
        key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        prefix TEXT NOT NULL,
        allotted_seconds INTEGER NOT NULL DEFAULT 600,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS service_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        service TEXT NOT NULL,
        stage_index INTEGER NOT NULL DEFAULT 0,
        arrived_at TEXT,
        called_at TEXT,
        ended_at TEXT NOT NULL,
        allotted_seconds INTEGER,
        extended_seconds INTEGER NOT NULL DEFAULT 0,
        actual_seconds INTEGER NOT NULL DEFAULT 0,
        wait_seconds INTEGER,
        outcome TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_log_service_ended ON service_log (service, ended_at);
      CREATE INDEX IF NOT EXISTS idx_log_ended ON service_log (ended_at);
      CREATE INDEX IF NOT EXISTS idx_tickets_queue ON tickets (current_service, status, service_arrival, id);
      CREATE INDEX IF NOT EXISTS idx_tickets_served ON tickets (status, served_at);
      CREATE INDEX IF NOT EXISTS idx_subs_ticket ON subscriptions (ticket_id);`);

    const existing = await db.get('SELECT COUNT(*) AS n FROM services');
    if (!existing.n) {
      let order = 0;
      for (const [key, label, prefix, minutes] of SEED_SERVICES) {
        await db.run('INSERT INTO services (key, label, prefix, allotted_seconds, enabled, sort_order) VALUES (?,?,?,?,1,?)',
          [key, label, prefix, minutes * 60, order++]);
      }
    }

    // Back-fill for tickets that were created by the old server.
    await db.exec(`UPDATE tickets SET current_service = json_extract(services, '$[' || COALESCE(service_index, 0) || ']')
                   WHERE current_service IS NULL`);
    await db.exec(`UPDATE tickets SET called_at = updated_at WHERE status = 'called' AND called_at IS NULL`);
    await db.exec(`UPDATE tickets SET allotted_seconds = (SELECT allotted_seconds FROM services WHERE key = tickets.called_service)
                   WHERE status = 'called' AND allotted_seconds IS NULL`);
    await db.exec(`UPDATE tickets SET secret = lower(hex(randomblob(9))) WHERE secret IS NULL OR secret = ''`);
    // The old code replaced status with 'cancel_requested', losing the real state. Treat those as waiting.
    await db.exec(`UPDATE tickets SET status = 'waiting' WHERE status = 'cancel_requested'`);
  },
];

async function migrate(db) {
  const { user_version: current } = await db.get('PRAGMA user_version');
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.write(async tx => {
      await MIGRATIONS[v](tx);
      await tx.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return MIGRATIONS.length;
}

module.exports = { open, migrate, DB };
