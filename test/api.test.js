'use strict';
// Run with: npm test   (uses Node's built-in test runner, no extra packages)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');
const { start } = require('../server');

const NO_PUSH = { VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '', RETENTION_DAYS: '0' };

async function boot(extra = {}) {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qms-')), 'test.db');
  const srv = await start({ PORT: 0, HOST: '127.0.0.1', DB_FILE: dbFile, STAFF_KEY: 'staff-key', ADMIN_KEY: 'admin-key', QUIET: '1', ...NO_PUSH, ...extra });
  const base = `http://127.0.0.1:${srv.port}`;
  const api = async (method, url, { body, token, headers = {} } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* csv etc. */ }
    return { status: res.status, body: json, text };
  };
  const login = async key => (await api('POST', '/auth/login', { body: { key } })).body.token;
  // Direct DB access, used to move the clock for a ticket without waiting in real time.
  // The server may be finishing a background write (e.g. dropping a push subscription), so retry on "locked"
  // instead of blocking inside the driver.
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const withDb = async fn => {
    for (let attempt = 0; ; attempt++) {
      const d = new sqlite3.Database(dbFile);
      try { return await fn(d); } catch (e) {
        if (!/locked|busy/i.test(String(e.message)) || attempt > 100) throw e;
        await sleep(15);
      } finally { await new Promise(r => d.close(r)); }
    }
  };
  const sql = (q, p = []) => withDb(d => new Promise((resolve, reject) => d.run(q, p, function (e) { e ? reject(e) : resolve(this.changes); })));
  const rows = (q, p = []) => withDb(d => new Promise((resolve, reject) => d.all(q, p, (e, r) => (e ? reject(e) : resolve(r)))));
  const staff = await login('staff-key');
  const admin = await login('admin-key');
  return { srv, api, login, staff, admin, sql, rows, dbFile, close: () => srv.close() };
}

const newTicket = (h, services = ['registrar'], extra = {}) =>
  h.api('POST', '/ticket', { body: { name: 'Ana', services, quer_type: 'Student', ...extra } }).then(r => r.body);

/* ---------------------------------- auth ---------------------------------- */

test('login: wrong key is rejected, right keys get the right role, tokens expire/tamper', async () => {
  const h = await boot();
  try {
    assert.equal((await h.api('POST', '/auth/login', { body: { key: 'nope' } })).status, 401);
    assert.equal((await h.api('POST', '/auth/login', { body: {} })).status, 400);
    const s = (await h.api('POST', '/auth/login', { body: { key: 'staff-key' } })).body;
    const a = (await h.api('POST', '/auth/login', { body: { key: 'admin-key' } })).body;
    assert.equal(s.role, 'staff');
    assert.equal(a.role, 'admin');
    assert.equal((await h.api('GET', '/auth/me', { token: s.token })).body.role, 'staff');
    assert.equal((await h.api('GET', '/auth/me')).status, 401);
    const tampered = s.token.slice(0, -2) + (s.token.endsWith('AA') ? 'BB' : 'AA');
    assert.equal((await h.api('GET', '/auth/me', { token: tampered })).status, 401);
    // the old header style still works for scripts
    assert.equal((await h.api('GET', '/admin/snapshot', { headers: { 'x-staff-key': 'staff-key' } })).status, 200);
    // the key must NOT be accepted in the query string any more
    assert.equal((await h.api('GET', '/admin/snapshot?staff_key=staff-key')).status, 401);
  } finally { await h.close(); }
});

test('login: repeated failures are throttled', async () => {
  const h = await boot({ LOGIN_RATE_MAX: '3' });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await h.api('POST', '/auth/login', { body: { key: 'bad' } })).status, 401);
    assert.equal((await h.api('POST', '/auth/login', { body: { key: 'bad' } })).status, 429);
    assert.equal((await h.api('POST', '/auth/login', { body: { key: 'staff-key' } })).status, 429);
  } finally { await h.close(); }
});

test('without ADMIN_KEY the staff key unlocks admin pages (original behaviour)', async () => {
  const h = await boot({ ADMIN_KEY: '' });
  try {
    const s = await h.login('staff-key');
    assert.equal((await h.api('GET', '/auth/me', { token: s })).body.role, 'admin');
  } finally { await h.close(); }
});

/* --------------------------------- tickets -------------------------------- */

test('create ticket: validation, secret, hidden names, position and ETA', async () => {
  const h = await boot();
  try {
    assert.equal((await h.api('POST', '/ticket', { body: { services: [] } })).status, 400);
    assert.equal((await h.api('POST', '/ticket', { body: { services: ['moon-base'] } })).status, 400);
    assert.equal((await h.api('POST', '/ticket', { body: { services: ['registrar', 'registrar', 'cashier'] } })).body.services.length, 2, 'duplicates removed');

    const t = await newTicket(h, ['registrar']);
    assert.ok(t.secret && t.secret.length >= 10, 'owner gets a private code');
    assert.equal(t.position, 2);
    assert.equal(t.eta_seconds, 600, 'one ticket ahead x 10 min allotment, nobody being served yet');

    const pub = (await h.api('GET', `/ticket/${t.id}`)).body;
    assert.equal(pub.name, '', 'names are not public');
    assert.equal(pub.secret, undefined, 'secret is never returned again');
    const asStaff = (await h.api('GET', `/ticket/${t.id}`, { token: h.staff })).body;
    assert.equal(asStaff.name, 'Ana');

    const pubQueue = (await h.api('GET', '/queue')).body;
    const staffQueue = (await h.api('GET', '/queue', { token: h.staff })).body;
    assert.equal(pubQueue.find(x => x.id === t.id).name, '');
    assert.equal(staffQueue.find(x => x.id === t.id).name, 'Ana');
  } finally { await h.close(); }
});

test('create ticket: public rate limit applies, staff are exempt', async () => {
  const h = await boot({ TICKET_RATE_MAX: '3' });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await h.api('POST', '/ticket', { body: { services: ['cashier'] } })).status, 200);
    assert.equal((await h.api('POST', '/ticket', { body: { services: ['cashier'] } })).status, 429);
    assert.equal((await h.api('POST', '/ticket', { body: { services: ['cashier'] }, token: h.staff })).status, 200);
  } finally { await h.close(); }
});

/* ----------------------------- calling & serving ---------------------------- */

test('call next: FIFO, one ticket per counter, and concurrent clicks cannot double-call', async () => {
  const h = await boot();
  try {
    const a = await newTicket(h), b = await newTicket(h), c = await newTicket(h);
    const results = await Promise.all(Array.from({ length: 6 }, () => h.api('POST', '/next', { body: { service: 'registrar' }, token: h.staff })));
    const ok = results.filter(r => r.status === 200 && r.body.ticket);
    const busy = results.filter(r => r.status === 409);
    assert.equal(ok.length, 1, 'exactly one request wins');
    assert.equal(busy.length, 5);
    assert.equal(ok[0].body.ticket.id, a.id, 'oldest ticket first');
    assert.equal(ok[0].body.ticket.displayToken, `R${String(a.id).padStart(3, '0')}`);

    const called = (await h.rows(`SELECT id FROM tickets WHERE status='called'`));
    assert.equal(called.length, 1);

    // a different counter is independent
    const d = await newTicket(h, ['cashier']);
    const other = await h.api('POST', '/next', { body: { service: 'cashier' }, token: h.staff });
    assert.equal(other.body.ticket.id, d.id);

    assert.equal((await h.api('POST', '/next', { body: {}, token: h.staff })).status, 400);
    assert.equal((await h.api('POST', '/next', { body: { service: 'registrar' } })).status, 401);
    void b; void c;
  } finally { await h.close(); }
});

test('empty queue: call next reports nothing waiting', async () => {
  const h = await boot();
  try {
    const r = await h.api('POST', '/next', { body: { service: 'records' }, token: h.staff });
    assert.equal(r.status, 200);
    assert.match(r.body.message, /No waiting/);
  } finally { await h.close(); }
});

test('multi-service ticket moves along its route and logs each stage', async () => {
  const h = await boot();
  try {
    const t = await newTicket(h, ['registrar', 'cashier']);
    await h.api('POST', '/next', { body: { service: 'registrar' }, token: h.staff });
    assert.equal((await h.api('POST', `/serve/${t.id}`, { body: { service: 'cashier' }, token: h.staff })).status, 400, 'wrong service');
    const moved = await h.api('POST', `/serve/${t.id}`, { body: { service: 'registrar' }, token: h.staff });
    assert.equal(moved.body.movedTo, 'cashier');
    let v = (await h.api('GET', `/ticket/${t.id}`)).body;
    assert.equal(v.status, 'waiting');
    assert.equal(v.current_service, 'cashier');
    assert.equal(v.displayToken, `C${String(t.id).padStart(3, '0')}`);
    assert.equal(v.called_at, null);

    await h.api('POST', '/next', { body: { service: 'cashier' }, token: h.staff });
    const done = await h.api('POST', `/serve/${t.id}`, { body: { service: 'cashier' }, token: h.staff });
    assert.equal(done.body.completed, true);
    v = (await h.api('GET', `/ticket/${t.id}`)).body;
    assert.equal(v.status, 'served');

    const log = await h.rows('SELECT service, outcome FROM service_log WHERE ticket_id = ? ORDER BY id', [t.id]);
    assert.deepEqual(log.map(l => [l.service, l.outcome]), [['registrar', 'moved'], ['cashier', 'served']]);
    assert.equal((await h.api('POST', `/serve/${t.id}`, { body: { service: 'cashier' }, token: h.staff })).status, 400, 'cannot serve twice');
  } finally { await h.close(); }
});

/* ----------------------------- time allotment ----------------------------- */

test('time allotment: snapshot at call time, extension, and actual time is logged', async () => {
  const h = await boot();
  try {
    const t = await newTicket(h, ['cashier']); // 5 min by default
    const called = (await h.api('POST', '/next', { body: { service: 'cashier' }, token: h.staff })).body.ticket;
    assert.equal(called.allotted_seconds, 300);

    // admin changes the allotment while the visit is in progress: the live visit keeps its 5 minutes
    const upd = await h.api('PUT', '/admin/services/cashier', { body: { allotted_seconds: 120 }, token: h.admin });
    assert.equal(upd.status, 200);
    let v = (await h.api('GET', `/ticket/${t.id}`)).body;
    assert.equal(v.allotted_seconds, 300);
    assert.equal(v.extended_seconds, 0);

    assert.equal((await h.api('POST', `/ticket/${t.id}/extend`, { body: { seconds: 5 }, token: h.staff })).status, 400, 'too small');
    assert.equal((await h.api('POST', `/ticket/${t.id}/extend`, { body: { seconds: 120 }, token: h.staff })).body.extended_seconds, 120);
    assert.equal((await h.api('POST', `/ticket/${t.id}/extend`, { body: { seconds: 300 }, token: h.staff })).body.extended_seconds, 420);
    assert.equal((await h.api('POST', `/ticket/${t.id}/extend`, { body: { seconds: 120 } })).status, 401);

    // pretend the customer has been at the window for 6 minutes
    await h.sql(`UPDATE tickets SET called_at = ? WHERE id = ?`, [new Date(Date.now() - 360_000).toISOString(), t.id]);
    const served = await h.api('POST', `/serve/${t.id}`, { body: { service: 'cashier' }, token: h.staff });
    assert.ok(served.body.actual_seconds >= 359 && served.body.actual_seconds <= 365);

    const [log] = await h.rows('SELECT * FROM service_log WHERE ticket_id = ?', [t.id]);
    assert.equal(log.allotted_seconds, 300);
    assert.equal(log.extended_seconds, 420);
    assert.ok(log.actual_seconds >= 359);

    // next visit uses the new 2 minute allotment
    await newTicket(h, ['cashier']);
    const next = (await h.api('POST', '/next', { body: { service: 'cashier' }, token: h.staff })).body.ticket;
    assert.equal(next.allotted_seconds, 120);
  } finally { await h.close(); }
});

test('extend only works on a ticket that is being served', async () => {
  const h = await boot();
  try {
    const t = await newTicket(h);
    assert.equal((await h.api('POST', `/ticket/${t.id}/extend`, { body: { seconds: 60 }, token: h.staff })).status, 400);
    assert.equal((await h.api('POST', '/ticket/99999/extend', { body: { seconds: 60 }, token: h.staff })).status, 404);
  } finally { await h.close(); }
});

test('estimated wait uses real history once there is some, and counts the visit in progress', async () => {
  const h = await boot();
  try {
    // three finished visits of 60s each at the registrar
    for (let i = 0; i < 3; i++) {
      const t = await newTicket(h);
      await h.api('POST', '/next', { body: { service: 'registrar' }, token: h.staff });
      await h.sql(`UPDATE tickets SET called_at = ? WHERE id = ?`, [new Date(Date.now() - 60_000).toISOString(), t.id]);
      await h.api('POST', `/serve/${t.id}`, { body: { service: 'registrar' }, token: h.staff });
    }
    const busy = await newTicket(h), w1 = await newTicket(h), w2 = await newTicket(h), w3 = await newTicket(h);
    await h.api('POST', '/next', { body: { service: 'registrar' }, token: h.staff }); // busy is called now (10 min allotment, just started)
    const e1 = (await h.api('GET', `/ticket/${w1.id}`)).body;
    const e3 = (await h.api('GET', `/ticket/${w3.id}`)).body;
    assert.equal(e1.position, 1);
    assert.equal(e3.position, 3);
    // remaining time of the visit in progress (~600s) + people ahead x average (~60s)
    assert.ok(e1.eta_seconds >= 595 && e1.eta_seconds <= 600, `got ${e1.eta_seconds}`);
    assert.ok(e3.eta_seconds - e1.eta_seconds >= 115 && e3.eta_seconds - e1.eta_seconds <= 125, 'two more people ahead, about 60s each');
    assert.equal((await h.api('GET', `/ticket/${busy.id}`)).body.position, 0);
    void w2;
  } finally { await h.close(); }
});

/* ------------------------------ hold / recall ----------------------------- */

test('hold and recall: recall is blocked while the counter is busy and restarts the timer', async () => {
  const h = await boot();
  try {
    const a = await newTicket(h), b = await newTicket(h);
    await h.api('POST', '/next', { body: { service: 'registrar' }, token: h.staff }); // a
    await h.api('POST', `/ticket/${a.id}/extend`, { body: { seconds: 120 }, token: h.staff });
    assert.equal((await h.api('POST', `/hold/${a.id}`, { token: h.staff })).status, 200);
    let v = (await h.api('GET', `/ticket/${a.id}`)).body;
    assert.equal(v.status, 'hold');
    assert.equal(v.extended_seconds, 0, 'extra time is cleared');

    await h.api('POST', '/next', { body: { service: 'registrar' }, token: h.staff }); // b
    const blocked = await h.api('POST', `/recall/${a.id}`, { token: h.staff });
    assert.equal(blocked.status, 409);

    await h.api('POST', `/serve/${b.id}`, { body: { service: 'registrar' }, token: h.staff });
    assert.equal((await h.api('POST', `/recall/${a.id}`, { token: h.staff })).status, 200);
    v = (await h.api('GET', `/ticket/${a.id}`)).body;
    assert.equal(v.status, 'called');
    assert.equal(v.allotted_seconds, 600);
    assert.equal((await h.api('POST', `/recall/${b.id}`, { token: h.staff })).status, 400, 'served tickets cannot be recalled');
  } finally { await h.close(); }
});

/* ---------------------------------- cancel --------------------------------- */

test('cancel request needs the ticket secret and does not erase the ticket status', async () => {
  const h = await boot();
  try {
    const t = await newTicket(h);
    await h.api('POST', '/next', { body: { service: 'registrar' }, token: h.staff });
    assert.equal((await h.api('POST', `/ticket/${t.id}/request_cancel`, { body: { reason: 'x' } })).status, 403, 'guessing a ticket number is not enough');
    assert.equal((await h.api('POST', `/ticket/${t.id}/request_cancel`, { body: { reason: 'x', secret: 'wrong' } })).status, 403);
    const ok = await h.api('POST', `/ticket/${t.id}/request_cancel`, { body: { reason: 'Emergency', secret: t.secret } });
    assert.equal(ok.status, 200);

    let v = (await h.api('GET', `/ticket/${t.id}`, { token: h.staff })).body;
    assert.equal(v.cancel_requested, true);
    assert.equal(v.cancel_reason, 'Emergency');
    assert.equal(v.status, 'called', 'still being served until staff decide');
    assert.equal((await h.api('GET', '/stats')).body.cancel_requests, 1);

    assert.equal((await h.api('POST', `/ticket/${t.id}/clear_cancel`, { token: h.staff })).status, 200);
    v = (await h.api('GET', `/ticket/${t.id}`)).body;
    assert.equal(v.cancel_requested, false);
    assert.equal(v.status, 'called');

    // staff can cancel on a customer's behalf without the secret
    assert.equal((await h.api('POST', `/ticket/${t.id}/request_cancel`, { body: { reason: 'Walked away' }, token: h.staff })).status, 200);
    assert.equal((await h.api('DELETE', `/ticket/${t.id}`)).status, 401);
    assert.equal((await h.api('DELETE', `/ticket/${t.id}`, { token: h.staff })).status, 200);
    assert.equal((await h.api('GET', `/ticket/${t.id}`)).status, 404);
  } finally { await h.close(); }
});

/* ----------------------------- admin and privacy ---------------------------- */

test('admin: only admins manage services, reports and exports; staff are refused', async () => {
  const h = await boot();
  try {
    assert.equal((await h.api('PUT', '/admin/services/cashier', { body: { allotted_seconds: 90 }, token: h.staff })).status, 403);
    assert.equal((await h.api('GET', '/admin/reports', { token: h.staff })).status, 403);
    assert.equal((await h.api('GET', '/export.csv', { token: h.staff })).status, 403);
    assert.equal((await h.api('GET', '/export.csv')).status, 401);
    assert.equal((await h.api('POST', '/admin/purge', { body: { older_than_days: 1 }, token: h.staff })).status, 403);

    assert.equal((await h.api('PUT', '/admin/services/cashier', { body: { allotted_seconds: 5 }, token: h.admin })).status, 400);
    assert.equal((await h.api('PUT', '/admin/services/cashier', { body: { allotted_seconds: 9999 }, token: h.admin })).status, 400);
    assert.equal((await h.api('PUT', '/admin/services/ghost', { body: { allotted_seconds: 90 }, token: h.admin })).status, 404);

    const created = await h.api('POST', '/admin/services', { body: { key: 'clinic', label: 'Clinic', prefix: 'M', allotted_seconds: 420 }, token: h.admin });
    assert.equal(created.status, 201);
    assert.equal((await h.api('POST', '/admin/services', { body: { key: 'clinic', label: 'X', prefix: 'Z', allotted_seconds: 60 }, token: h.admin })).status, 409);
    assert.equal((await h.api('POST', '/admin/services', { body: { key: 'lab', label: 'Lab', prefix: 'M', allotted_seconds: 60 }, token: h.admin })).status, 409, 'duplicate ticket letter');
    assert.equal((await h.api('POST', '/admin/services', { body: { key: 'Bad Key!', label: 'X', prefix: 'Q', allotted_seconds: 60 }, token: h.admin })).status, 400);

    // a new service is immediately usable by the kiosk, and disabling hides it
    const t = await newTicket(h, ['clinic']);
    assert.equal(t.displayToken, `M${String(t.id).padStart(3, '0')}`);
    assert.ok((await h.api('GET', '/services')).body.some(s => s.key === 'clinic'));
    await h.api('PUT', '/admin/services/clinic', { body: { enabled: false }, token: h.admin });
    assert.ok(!(await h.api('GET', '/services')).body.some(s => s.key === 'clinic'));
    assert.equal((await h.api('POST', '/ticket', { body: { services: ['clinic'] } })).status, 400);
    // ...but tickets already waiting there can still be called, so nobody is stranded
    assert.equal((await h.api('POST', '/next', { body: { service: 'clinic' }, token: h.staff })).body.ticket.id, t.id);
  } finally { await h.close(); }
});

test('reports summarise visits, on-time rate and per-service averages', async () => {
  const h = await boot();
  try {
    const mk = async (service, seconds, extend = 0) => {
      const t = await newTicket(h, [service]);
      await h.api('POST', '/next', { body: { service }, token: h.staff });
      if (extend) await h.api('POST', `/ticket/${t.id}/extend`, { body: { seconds: extend }, token: h.staff });
      await h.sql('UPDATE tickets SET called_at = ? WHERE id = ?', [new Date(Date.now() - seconds * 1000).toISOString(), t.id]);
      await h.api('POST', `/serve/${t.id}`, { body: { service }, token: h.staff });
    };
    await mk('cashier', 120);       // within the 5 minute allotment
    await mk('cashier', 240);       // within
    await mk('cashier', 420);       // over by 2 minutes
    await mk('cashier', 420, 180);  // over the base but inside the extension (300 + 180)
    const rep = (await h.api('GET', '/admin/reports?range=today', { token: h.admin })).body;
    const cashier = rep.per_service.find(s => s.service === 'cashier');
    assert.equal(cashier.visits, 4);
    assert.equal(cashier.within_pct, 75);
    assert.equal(cashier.extended_visits, 1);
    assert.ok(Math.abs(cashier.avg_actual - 300) <= 2);
    assert.equal(rep.totals.visits, 4);
    assert.equal(rep.totals.tickets_completed, 4);
    assert.equal(rep.hourly.reduce((a, b) => a + b.count, 0), 4);
    assert.equal(rep.per_service.find(s => s.service === 'registrar').visits, 0);
  } finally { await h.close(); }
});

test('csv export neutralises spreadsheet formulas', async () => {
  const h = await boot();
  try {
    await newTicket(h, ['registrar'], { name: '=HYPERLINK("http://evil")' });
    const csv = (await h.api('GET', '/export.csv', { token: h.admin })).text;
    assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"")"`), csv);
  } finally { await h.close(); }
});

test('purge removes old finished tickets (names) but keeps stage timings for reports', async () => {
  const h = await boot();
  try {
    const t = await newTicket(h);
    await h.api('POST', '/next', { body: { service: 'registrar' }, token: h.staff });
    await h.sql('UPDATE tickets SET called_at = ? WHERE id = ?', [new Date(Date.now() - 90_000).toISOString(), t.id]);
    await h.api('POST', `/serve/${t.id}`, { body: { service: 'registrar' }, token: h.staff });
    await h.sql('UPDATE tickets SET served_at = ? WHERE id = ?', [new Date(Date.now() - 40 * 86_400_000).toISOString(), t.id]);
    const keep = await newTicket(h);
    const r = (await h.api('POST', '/admin/purge', { body: { older_than_days: 30 }, token: h.admin })).body;
    assert.equal(r.tickets_removed, 1);
    assert.equal((await h.api('GET', `/ticket/${t.id}`)).status, 404);
    assert.equal((await h.api('GET', `/ticket/${keep.id}`)).status, 200, 'active tickets are never purged');
    assert.equal((await h.rows('SELECT COUNT(*) AS n FROM service_log'))[0].n, 1);
  } finally { await h.close(); }
});

test('malformed input is handled without crashing the server', async () => {
  const h = await boot();
  try {
    const res = await fetch(`http://127.0.0.1:${h.srv.port}/ticket`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
    assert.equal(res.status, 400);
    assert.equal((await h.api('GET', '/ticket/abc')).status, 400);
    assert.equal((await h.api('GET', '/ticket/0')).status, 400);
    assert.equal((await h.api('POST', '/ticket', { body: { services: 'registrar' } })).status, 400);
    const long = await newTicket(h, ['registrar'], { name: 'x'.repeat(500) });
    assert.equal((await h.api('GET', `/ticket/${long.id}`, { token: h.staff })).body.name.length, 80);
    assert.equal((await h.api('GET', '/health')).status, 200);
    assert.equal((await h.api('GET', '/vapid.json')).status, 404);
  } finally { await h.close(); }
});

/* ------------------------------- live events ------------------------------- */

test('live events: the stream delivers updates and carries no customer names', async () => {
  const h = await boot();
  const ctrl = new AbortController();
  try {
    const res = await fetch(`http://127.0.0.1:${h.srv.port}/events`, { signal: ctrl.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let seen = '';
    const readUntil = async (re, ms = 3000) => {
      const stop = Date.now() + ms;
      while (!re.test(seen) && Date.now() < stop) {
        const chunk = await Promise.race([reader.read(), new Promise(r => setTimeout(() => r({ timeout: true }), 200))]);
        if (chunk && chunk.value) seen += decoder.decode(chunk.value);
      }
      return re.test(seen);
    };
    assert.ok(await readUntil(/:ok/), 'connection is acknowledged');

    const t = await newTicket(h, ['registrar'], { name: 'Secret Sam' });
    assert.ok(await readUntil(/event: created/), 'created event arrives');
    await h.api('POST', '/next', { body: { service: 'registrar' }, token: h.staff });
    assert.ok(await readUntil(/event: called/), 'called event arrives');
    const called = JSON.parse(seen.split('event: called\ndata: ')[1].split('\n')[0]);
    assert.equal(called.id, t.id);
    assert.equal(called.displayToken, `R${String(t.id).padStart(3, '0')}`);
    assert.ok(called.called_at && called.allotted_seconds === 600, 'event carries the timer fields');
    assert.ok(!/Secret Sam/.test(seen), 'no customer name is ever broadcast');
    await h.api('POST', `/ticket/${t.id}/extend`, { body: { seconds: 60 }, token: h.staff });
    assert.ok(await readUntil(/event: extended/), 'extend is broadcast so every screen updates');
  } finally { ctrl.abort(); await h.close(); }
});

/* ------------------------------- upgrade path ------------------------------ */

test('an existing database from the old server upgrades in place', async () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qms-old-')), 'old.db');
  const old = new sqlite3.Database(dbFile);
  const run = q => new Promise((res, rej) => old.run(q, e => (e ? rej(e) : res())));
  await run(`CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, services TEXT NOT NULL DEFAULT '[]', quer_type TEXT,
    status TEXT NOT NULL DEFAULT 'waiting', called_service TEXT DEFAULT '', service_index INTEGER DEFAULT 0, service_arrival TEXT,
    created_at TEXT, updated_at TEXT, served_at TEXT, cancel_requested INTEGER DEFAULT 0, cancel_reason TEXT DEFAULT '', cancel_requested_at TEXT DEFAULT '')`);
  await run(`CREATE TABLE subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT NOT NULL UNIQUE, keys TEXT, ticket_id INTEGER DEFAULT NULL, created_at TEXT DEFAULT (datetime('now')))`);
  const ts = new Date(Date.now() - 120_000).toISOString();
  await run(`INSERT INTO tickets (name, services, status, called_service, service_index, service_arrival, created_at, updated_at) VALUES
    ('Old A', '["registrar","cashier"]', 'called', 'registrar', 0, '${ts}', '${ts}', '${ts}'),
    ('Old B', '["cashier"]', 'cancel_requested', '', 0, '${ts}', '${ts}', '${ts}'),
    ('Old C', '["records"]', 'waiting', '', 0, '${ts}', '${ts}', '${ts}')`);
  await new Promise(res => old.close(res));

  const srv = await start({ PORT: 0, HOST: '127.0.0.1', DB_FILE: dbFile, STAFF_KEY: 'k', QUIET: '1', ...NO_PUSH });
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const q = await (await fetch(`${base}/queue`, { headers: { 'x-staff-key': 'k' } })).json();
    const a = q.find(t => t.name === 'Old A'), b = q.find(t => t.name === 'Old B'), c = q.find(t => t.name === 'Old C');
    assert.equal(a.status, 'called');
    assert.equal(a.allotted_seconds, 600, 'in-progress visit gets its service allotment');
    assert.equal(a.current_service, 'registrar');
    assert.equal(b.status, 'waiting', 'status lost by the old cancel flow is restored');
    assert.equal(c.current_service, 'records');
    // and the upgraded database works
    const r = await fetch(`${base}/serve/${a.id}`, { method: 'POST', headers: { 'x-staff-key': 'k', 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'registrar' }) });
    assert.equal(r.status, 200);
  } finally { await srv.close(); }
  // second start on the already-upgraded DB must be a no-op
  const again = await start({ PORT: 0, HOST: '127.0.0.1', DB_FILE: dbFile, STAFF_KEY: 'k', QUIET: '1', ...NO_PUSH });
  await again.close();
});
