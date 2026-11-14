# What changed, and what to do now

This file has two rounds: **Round 2** (customer pages and structure) first, then **Round 1** (admin console, time allotment, server).

---

# Round 2: kiosk, display, QR poster and structure

## Do these now
1. Rebuild the admin console: `cd frontend && npm install && npm run build` (or `start.bat rebuild`). The Vite config now reads shared files from `../public`.
2. Delete the old `frontend/public` folder if your copy still has one (its pages moved to `public/`). **Re-print the QR poster only if the address changed**: `/kiosk.html` still works, so old posters keep working.
3. Run `npm test` (26 tests).

## What was wrong, and what is different

| Problem found | Now |
|---|---|
| **Push alerts were probably never shown.** The service worker asked for `renotify: true` without a `tag`; browsers reject that. | The worker always sets a tag (and the server sends one), skips the pop-up when the page is already on screen, and focuses the right tab when tapped. |
| `qr.html` loaded its generator from a CDN (fails with no internet), made you type the address (typing `localhost` makes a code phones cannot open), referenced a button that did not exist, and used its own unrelated style. | A QR generator is built in (no internet). The page lists this computer's network addresses and warns about `localhost`; prints a one-page A4 poster; saves PNG/SVG. |
| The kiosk was one 940-line file with inline CSS/JS, a hand-written drag-and-drop engine, and ~100 lines that merged server events into a locally cached ticket (which could drift from the truth). | Small modules. The phone stores only the ticket id and private code; every screen is read fresh from the server. Events and timers are just reasons to ask again. Tap to choose services, arrows to reorder. |
| Customers could not see the line before choosing. | Each service shows people waiting and the wait a new arrival would face. |
| Kiosk asked for notification permission on page load (browsers punish this) and used `alert`, `prompt` and `confirm`. | Permission is asked only when a customer taps "Turn on alerts". Cancel is an in-page sheet. |
| The kiosk could not be used on a shared lobby tablet (one stored ticket blocked the next person). | `/kiosk?lobby` shows a slip, remembers nothing, and clears itself between people. |
| Display: hard-coded services, tokens too small on TVs, no way to hear a call, no memory of recent calls. | Columns follow your services and fill the screen; chime + spoken announcement (opt-in); "recently called" strip; full screen; hides the mouse. |
| Every phone refreshed the instant any event arrived (hundreds of simultaneous requests). | Refreshes are spread over a short random delay and merged; your own ticket still updates immediately. |
| Cached pages: HTML/JS could be served stale for an hour. | Pages revalidate on every load (cheap), images cache for a day, admin assets are hashed. |
| No Content-Security-Policy; inline scripts everywhere. | Strict policy (own scripts only, no CDNs, no inline script). A test fails if a CDN or inline script is ever added. |
| Logo was 222 KB on every phone. | 16 KB header logo, 76 KB print logo; the unused background image is gone. |
| `start.*` scripts launched a *development* server in a second window on every start. | They install/build only when needed and run one server in one window. |
| Customer type list and school name were hard-coded in several files. | `SCHOOL_NAME` and `CUSTOMER_TYPES` in `.env`; the admin New ticket dialog uses the same list. |

## New server pieces
`GET /config`, `GET /network-info`, richer `GET /services` (waiting, serving, estimated wait), push payload `tag`. Clean addresses `/kiosk`, `/display`, `/qr`.

## Structure
Customer pages moved from `frontend/public` (a folder meant for Vite's static files) to a top-level `public/` served directly by Node, split into `css/`, `js/shared`, `js/kiosk`, `js/display`, `js/qr`, `img/`, `sound/`. The admin console stays in `frontend/`. Shared code (API client, live updates, DOM helpers) is written once instead of three times.

## Languages
Everything stays JavaScript. The customer pages are deliberately dependency-free ES modules: nothing to download beyond ~30 KB per page on school Wi-Fi, no build step to break, and the admin console keeps React where its state is genuinely complex. Rewriting any part in another language would add moving parts without fixing a single problem above.

## How it was checked
26 API tests; browser runs of the kiosk (full customer journey on a phone, lobby mode, dark mode), display (with audio and speech spied on), QR page, and the admin console; zero console errors or security-policy violations. The QR generator was proven by decoding its output with OpenCV for every version (1-20), every error-correction level and all 8 masks, including UTF-8 text; the downloaded PNG and the on-screen poster both decode to the right address.
**Not checked:** real push delivery (needs HTTPS and a real device), real speech voices and audio output (I verified the calls, not the sound), Safari/iOS (push there needs the page added to the Home Screen), and Vite itself (I compile with esbuild; please run `npm run build`).

## Left alone / ideas
`docker-compose.yml` is still empty. No offline caching in the service worker (a stale queue page is worse than a slow one). Filipino translation of the kiosk is a natural next step; I did not guess at translations. An automatic no-show timer is still not built.

---

# Round 1: admin console, time allotment, server

## Do these first (security)

1. **Replace your keys.** The old files exposed secrets:
   - `frontend/public/vapid.json` was served to every visitor and contained the **push private key**. It is deleted, but the key must be treated as stolen: run `npx web-push generate-vapid-keys` and put the new pair in `.env`.
   - The staff key was compiled into the browser JavaScript. Set a new `STAFF_KEY` (and an `ADMIN_KEY`) in `.env`.
   - `.env`, `frontend/certs/*.pem|key` and `node_modules` were in the repository. A `.gitignore` is added; also run `git rm --cached -r .env frontend/certs node_modules` and commit. They remain in git history, which is another reason to rotate the keys above and regenerate the mkcert certificates.
2. Rebuild the panel: `cd frontend && npm install && npm run build`, then `npm start`.
3. Run `npm test` once on your machine.

## New: time allotment

See the README section "Time allotment". Per-service allotted time, live countdown dial, extra time, estimated wait for customers, visit log, and reports.

## Admin panel

Rewritten (same stack: React + Vite, no new libraries). Sidebar navigation; a counter board with a dial per window; summary strip (waiting, at counters, over time, on hold, longest wait, completed today); filterable queue table with a "completed today" tab; reports; service settings (add, rename, reorder, hide, change time); walk-in ticket dialog; cancel-request review; light and dark theme; works on phones. Errors show as messages instead of `alert()`.

## Server

Still Node.js. I looked at whether any part would be better in another language and concluded no: the work is a few hundred tickets a day, I/O-bound, and the real problems were design problems (below), which a rewrite would not have fixed.

| Problem in the old version | Now |
|---|---|
| Two staff pressing *Call next* together could call the same ticket; a counter could be left holding an orphaned ticket | One atomic statement picks and claims the ticket, and a counter serves one ticket at a time (clear message if busy) |
| Every phone downloaded **every ticket ever created, with names**, on every event, to work out its position | Server returns `position` and `eta_seconds` in `GET /ticket/:id`; `GET /queue` returns only active tickets, names hidden unless staff |
| Anyone could cancel any ticket by guessing its sequential number | Each ticket has a private code returned only to its owner |
| Requesting a cancel overwrote the ticket's status (a ticket being served vanished from its counter) | Status is untouched; a flag marks the request |
| `/export.csv` (names) was public; CSV could carry spreadsheet formulas | Admin only; formulas neutralised |
| Staff key checked in the browser; key accepted in the URL | Signed expiring tokens, constant-time comparison, login throttling; key in URL removed |
| No limits on ticket creation or input length; unknown services accepted | Rate limit, length limits, services validated against the configured list |
| Look-up-then-update steps could interleave between requests; slow full-table scans for each call | All writes go through a one-at-a-time queue; WAL mode; indexes on the columns the queue uses; versioned migrations (replaces `migrate.js`, which referenced columns that no longer existed) |
| Live-update stream dropped by idle proxies | Heartbeat every 25 s |
| Server never served the built frontend; dev server crashed without the author's personal certificates | Express serves `frontend/dist`; HTTPS is optional in both |
| Customer data kept forever | Completed tickets deleted after `RETENTION_DAYS` (default 30); timings kept for reports |

API paths used by the kiosk are unchanged. New: `/auth/login`, `/services`, `/admin/*`, `/ticket/:id/extend`, `/push/key`.

## Kiosk and display

- `kiosk.html`: services (names, order, minutes per visit) come from the server; position and estimated wait come from the server; the private ticket code is used for cancel and notifications; push key is fetched instead of hard-coded.
- `display.html`: rewritten for a TV; columns follow your services; tokens only; one refresh per burst of events.
- `qr.html`, `sw.js`: unchanged.

## Removed

`migrate.js` (obsolete), `frontend/public/vapid.json` (leaked key), `frontend/public/admin-login.html` (contained unresolved git merge-conflict markers and was no longer used), unused CSS/images.
`body-parser` is no longer used by the server; `npm uninstall body-parser` if you like.

## Be aware

- **Not run here:** Vite itself (I compiled the panel with esbuild, the compiler Vite uses, and drove it in a real browser) and the native `sqlite3` package (tests ran against Node's built-in SQLite). Please run `npm test` and `npm run build` on your machine.
- Names are hidden on the public display by default. Set `PUBLIC_SHOW_NAMES=true` if you want them.
- A service turned off in Settings disappears from the kiosk but still lets people already waiting be served.
- Not built (ideas for later): automatic no-show timer when a called customer does not arrive; per-counter staff accounts; Docker setup (`docker-compose.yml` is still empty).
