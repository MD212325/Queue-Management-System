'use strict';
/** Server-Sent Events hub with heartbeats so proxies and Wi-Fi gear don't drop idle streams. */
function createBus({ heartbeatMs = 25_000 } = {}) {
  const clients = new Set();

  const timer = setInterval(() => {
    for (const res of clients) {
      try { res.write(':hb\n\n'); } catch { clients.delete(res); }
    }
  }, heartbeatMs);
  timer.unref();

  return {
    get size() { return clients.size; },
    handler(req, res) {
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      res.write('retry: 3000\n:ok\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    emit(name, payload = {}) {
      const msg = `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const res of clients) {
        try { res.write(msg); } catch { clients.delete(res); }
      }
    },
    closeAll() {
      clearInterval(timer);
      for (const res of clients) { try { res.end(); } catch { /* ignore */ } }
      clients.clear();
    },
  };
}
module.exports = { createBus };
