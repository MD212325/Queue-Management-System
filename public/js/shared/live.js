// Live updates from the server (Server-Sent Events) with automatic recovery, plus a helper that
// keeps hundreds of phones from all refreshing in the same instant.

const EVENTS = ['created', 'called', 'served', 'moved', 'reassigned', 'deleted', 'hold', 'recalled',
  'extended', 'cancel_requested', 'cancel_cleared', 'services_updated', 'priority_changed', 'announce', 'announcement', 'settings_updated'];

/** onEvent(name, payload); onState('live' | 'offline'). Returns { close() }. */
export function connectLive(onEvent, onState) {
  let source = null;
  let timer = null;
  let attempts = 0;
  let closed = false;

  function open() {
    if (closed) return;
    source = new EventSource('/events');
    source.onopen = () => { attempts = 0; onState('live'); };
    source.onerror = () => {
      onState('offline');
      // The browser retries by itself unless the connection was refused outright; then we back off.
      if (source.readyState === EventSource.CLOSED) {
        source.close();
        timer = setTimeout(open, Math.min(30000, 1000 * 2 ** attempts++));
      }
    };
    for (const name of EVENTS) {
      source.addEventListener(name, e => {
        let payload = {};
        try { payload = JSON.parse(e.data); } catch { /* ignore */ }
        onEvent(name, payload);
      });
    }
  }
  open();
  return { close() { closed = true; clearTimeout(timer); if (source) source.close(); } };
}

/**
 * Run fn after a random delay in [minMs, maxMs]. Calls made while one is already waiting are merged.
 * Spreads out the refreshes that follow a broadcast event so the server sees a trickle, not a spike.
 */
export function coalesce(fn, minMs = 400, maxMs = 2200) {
  let timer = null;
  const run = () => { timer = null; fn(); };
  return {
    soon() { if (timer === null) timer = setTimeout(run, minMs + Math.random() * (maxMs - minMs)); },
    now() { clearTimeout(timer); run(); },
    cancel() { clearTimeout(timer); timer = null; },
  };
}
