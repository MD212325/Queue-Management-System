# Queue Management System

A walk-in queue for school service counters (Registrar, Cashier, Admissions, Records, or any you add).

| Page | Address | Who uses it |
|---|---|---|
| **Admin console** | `/` | Counter staff and administrators: call, time and complete visits; reports; settings |
| **Kiosk** | `/kiosk` | Customers, on their own phone (or a shared lobby tablet) |
| **Public display** | `/display` | A TV or monitor: "Now serving", with sound |
| **QR poster** | `/qr` | Staff: prints the poster that sends customers to the kiosk |

Built with Node.js + Express + SQLite on the server. The admin console is React (Vite). The three customer pages are plain
HTML/CSS/JavaScript modules that need no build step and load nothing from the internet.

## Quick start

Requires [Node.js](https://nodejs.org/) 20 or newer (22 recommended).

```bash
cp .env.example .env      # then edit .env: set STAFF_KEY (and ideally ADMIN_KEY)
./start.sh                # Windows: start.bat   PowerShell: .\start.ps1
```

The script installs packages and builds the admin console the first time, then runs the server. Open `http://localhost:4000`
and sign in with your staff key. Use `start.sh rebuild` (or `start.bat rebuild`) after changing admin console source.

Prefer to do it by hand? `npm install && npm run build && npm start`.

The database (`queue.db`) is created on first start. A database from the older version is upgraded in place automatically
(copy `queue.db` first if you like to be safe).

### Development

```bash
npm start                       # the server, in one terminal
cd frontend && npm run dev      # admin console with hot reload on :5173, in another
```

Customer pages in `public/` are served by the Node server as plain files: edit, refresh, done. See
`frontend/.env.example` for HTTPS on the dev server.

## Setting up the customer screens

**QR poster** (`/qr`). Open it on the server PC. It lists the PC's network addresses; pick the Wi-Fi one (a QR code that
points at `localhost` cannot be opened by phones, and the page warns you). Print the poster, or save it as PNG/SVG.

**Kiosk** (`/kiosk`). Customers tick the services they need and **drag them into the order they want to visit them**
(or use the arrow keys / the arrows in the route summary). They see the live line and wait for each service, get a
number, their place in line, an estimated wait and a full-screen alert (sound and vibration) when called, can ask to
cancel, and are asked to rate their visit afterwards. The phone keeps only the ticket number and its private code;
everything shown is read fresh from the server. Light and dark theme: the button in the header (light is the default).

| Address | What it does |
|---|---|
| `/kiosk` | Normal customer page (phones) |
| `/kiosk?lobby` | Shared lobby tablet: shows a slip, remembers nothing, clears itself between people, **Print my number** button |
| `/kiosk?lobby&autoprint` | Same, and prints the slip as soon as the number is issued. For a silent receipt printer start Chrome/Edge with `--kiosk-printing` |
| `/kiosk?theme=dark` | Force a theme (also works on `/display`) |

**Public display** (`/display`). Put it on a TV (double-click for full screen). Numbers only, never names. Light theme by
default, dark one button away (`/display?theme=dark` to make a TV always dark). Priority tickets carry a star; a counter on a
break says so and why; the last calls are listed at the bottom for people who missed theirs.
**Announcements** need one click per browser session (browsers block sound until then): press **Announcements** once.
For an unattended TV start the browser with `--autoplay-policy=no-user-gesture-required` and open `/display?sound`.

Change the school name and the customer type list with `SCHOOL_NAME` and `CUSTOMER_TYPES` in `.env`; replace the logos in
`public/img/` to rebrand.

## Queue features

- **Priority lane.** The kiosk offers a priority option (senior citizens, persons with a disability, pregnant women). Priority
  tickets are called before regular ones and are marked with a star for staff. Staff can give or remove priority on any
  waiting ticket, and an administrator can switch the customer option off (Settings → Customer screens).
- **Call a specific ticket.** Besides *Call next*, staff can call any waiting or held ticket (the megaphone on its row), for
  example when the next person is not there. The counter must be free.
- **Announcements.** *Announce again* on a counter calls the number out again on the display (spoken) and re-alerts the
  customer's phone. *Announce* (top bar) sends a typed message to the display and every open kiosk page, optionally read aloud.
  An administrator can turn **automatic announcements** off, so calls appear on the display but are spoken only when staff
  announce them by hand.
- **Breaks.** *Pause* a counter (the cup icon) with a reason ("Lunch until 1:00 PM"). Customers cannot take new numbers for
  it, nobody can be called, and the kiosk and display show the reason. A visit in progress can still be completed. *Resume*
  reopens it.
- **Customer feedback.** After being served, customers rate the visit 1 to 5 stars with an optional comment. Reports show the
  average, the breakdown and recent comments, with a CSV export. Comments are deleted with the old tickets; ratings stay.
- **Lobby printing.** See `/kiosk?lobby&autoprint` above.

## Time allotment

Every service has an **allotted time per customer** (Admin → *Services & time*). It is used in four places:

1. **Countdown dial.** When a ticket is called, its counter shows a dial counting down from the allotted time. It turns
   amber when about 20% is left and red, counting up (`+02:13`), once the time is used.
2. **Extra time.** Staff can add 2 or 5 minutes for a complicated case. The dial and the reports account for it.
3. **Estimated wait.** Customers see an estimate: time left on the visit in progress plus the number of people ahead times
   the recent average visit length (the allotment is used until there are 3+ finished visits).
4. **Reports.** Average time vs allotted time per service, share of visits finished on time, longest visit, hourly volume.
   CSV export of every visit.

A visit keeps the allotment it started with: editing a service's time affects the *next* customer called. Visits shorter than
10 seconds (accidental clicks) are ignored in averages.

## Roles

| Key | Can do |
|---|---|
| `STAFF_KEY` | Call, complete, hold, recall, call a specific ticket, give priority, add time, pause a counter, announce, remove, walk-in tickets, see the line |
| `ADMIN_KEY` (optional) | Everything above plus services, time allotments, **customer-screen settings (auto-announce, priority lane)**, reports, exports, data deletion |

If `ADMIN_KEY` is empty, `STAFF_KEY` can do everything. Keys are typed into the sign-in page and exchanged for a signed token
that expires (12 h by default). They are never stored in the browser or included in the JavaScript.

## Configuration

All settings are environment variables (in `.env`). See [`.env.example`](.env.example) for the full list with explanations.

## Tests

```bash
npm test
```

Runs the API test-suite (Node's built-in test runner, no extra packages): sign-in and roles, simultaneous "Call next" clicks,
the time-allotment rules, estimated waits, priority, calling out of turn, announcements, breaks, feedback, reports, privacy,
the customer pages' security headers and offline guarantees, and upgrading an old database.

## Project layout

```
server.js              starts the server
src/                   server code
  config.js            settings            queue.js   all queue rules (tickets, time allotment, ETA, reports)
  db.js                SQLite + migrations routes.js  HTTP endpoints
  auth.js              tokens and roles    sse.js     live updates     push.js  notifications     network.js  LAN addresses
public/                customer pages, served as-is (no build)
  kiosk.html display.html qr.html sw.js theme-init.js
  css/                 base.css (shared), kiosk.css, display.css, qr.css
  js/shared/           api, live updates, DOM helpers, theme, drag-and-drop, formatting (used by the pages)
  js/kiosk/            main (controller), views, store, alerts, push
  js/display/          main, announce (chime + speech)
  js/qr/               main, qrcode (the QR generator)
  img/ sound/
frontend/              admin console (React + Vite): src/ , builds into dist/
test/                  API tests
```

MIT License.
