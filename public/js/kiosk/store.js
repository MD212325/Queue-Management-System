// What this phone remembers: only the ticket's id and its private code. Everything else (status, place in
// line, estimate) is asked of the server, so there is never a stale local copy to get out of step.
const KEY = 'qms.ticket';
const ACK = 'qms.ack';

function read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } }

export function loadTicket() {
  const mine = read(KEY);
  if (mine && mine.id) return mine;
  // Tickets taken with the old kiosk page: keep following them (they have no private code, so cancel needs staff).
  const legacy = read('kiosk_current_ticket');
  if (legacy && legacy.id) {
    try { localStorage.removeItem('kiosk_current_ticket'); localStorage.removeItem('kiosk_push_subscription'); } catch { /* ignore */ }
    const adopted = { id: legacy.id, secret: '', savedAt: Date.now() };
    write(KEY, adopted);
    return adopted;
  }
  return null;
}
export const saveTicket = mine => write(KEY, { ...mine, savedAt: Date.now() });
export function clearTicket() { try { localStorage.removeItem(KEY); localStorage.removeItem(ACK); } catch { /* ignore */ } }

/** The "it's your turn" screen has been dismissed for this particular call (identified by its timestamp). */
export const ackedCall = () => read(ACK);
export const ackCall = calledAt => write(ACK, calledAt);
