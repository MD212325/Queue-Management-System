# What changed, and what to do now

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
