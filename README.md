# Queue Management System

A walk-in queue for school service counters (Registrar, Cashier, Admissions, Records, or any you add).

- **Admin console** (`/`): call, time and complete every visit; manage the line; reports; settings.
- **Kiosk** (`/kiosk.html`): customers take a ticket on their phone or a tablet and are notified when called.
- **Public display** (`/display.html`): "Now serving" screen for a TV. Shows tokens only.
- **QR page** (`/qr.html`): QR code that points customers at the kiosk.

Built with Node.js + Express + SQLite on the server and React (Vite) for the admin console.

## Quick start

Requires [Node.js](https://nodejs.org/) 20 or newer (22 recommended).

```bash
npm install                      # server
cp .env.example .env             # then edit .env: set STAFF_KEY (and ideally ADMIN_KEY)
cd frontend && npm install && npm run build && cd ..
npm start
```

Open `http://localhost:4000` and sign in with your staff key. Customers use `http://<this-pc-address>:4000/kiosk.html`.

The database (`queue.db`) is created on first start. An existing database from the older version is upgraded in place automatically (make a copy of `queue.db` first if you like to be safe).

### Development

Run the server (`npm start`) and, in a second terminal, the panel with hot reload:

```bash
cd frontend
npm run dev                      # http://localhost:5173, proxies API calls to :4000
```

For HTTPS on the dev server (so phones on your Wi-Fi can use notifications) copy `frontend/.env.example` to `frontend/.env.local` and point it at your mkcert files.

## Time allotment

Every service has an **allotted time per customer** (Admin → *Services & time*). It is used in four places:

1. **Countdown dial.** When a ticket is called, its counter shows a dial counting down from the allotted time. It turns amber when about 20% is left and red, counting up (`+02:13`), once the time is used.
2. **Extra time.** Staff can add 2 or 5 minutes for a complicated case. The dial and the reports account for it.
3. **Estimated wait.** Customers see an estimate on their phone: time left for the visit in progress plus the number of people ahead times the recent average visit length (falls back to the allotment until there are 3+ finished visits).
4. **Reports.** Average time vs allotted time per service, share of visits finished on time, longest visit, hourly volume. CSV export of every visit.

A visit keeps the allotment it started with: editing a service's time affects the *next* customer called, never the one at the counter.
Visits shorter than 10 seconds (accidental clicks) are ignored in averages.

## Roles

| Key | Can do |
|---|---|
| `STAFF_KEY` | Call, complete, hold, recall, add time, remove, walk-in tickets, see the line |
| `ADMIN_KEY` (optional) | Everything above plus services, time allotments, reports, exports, data deletion |

If `ADMIN_KEY` is empty, `STAFF_KEY` can do everything.

Keys are typed into the sign-in page and exchanged for a signed token that expires (12 h by default). They are never stored in the browser or included in the JavaScript.

## Configuration

All settings are environment variables (in `.env`). See [`.env.example`](.env.example) for the full list with explanations.

## Tests

```bash
npm test
```

Runs the API test-suite (Node's built-in test runner, no extra packages): sign-in and roles, simultaneous "Call next" clicks, the time-allotment rules, estimated waits, reports, privacy, and upgrading an old database.

## Project layout

```
server.js            starts the server
src/config.js        settings
src/db.js            SQLite access, one-writer-at-a-time queue, schema migrations
src/queue.js         all queue rules (tickets, time allotment, ETA, reports)
src/auth.js          sign-in tokens and roles
src/routes.js        HTTP endpoints
src/sse.js           live updates to screens
src/push.js          push notifications
test/                API tests
frontend/src/        admin console (React)
frontend/public/     kiosk, display, QR page, service worker
```

MIT License.
