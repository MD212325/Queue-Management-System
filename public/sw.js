// Service worker: shows "it's your turn" alerts when the kiosk page is closed or the phone is locked.
// (It does not cache anything: a stale copy of a queue page is worse than a slow one.)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { title: 'Queue update', body: event.data ? event.data.text() : '' }; }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Open pages re-read the ticket from the server; they do not trust the push contents.
    for (const w of windows) w.postMessage({ type: payload.type || 'push' });
    // If the customer is looking at the page right now, the page itself does the alerting.
    if (windows.some(w => w.visibilityState === 'visible')) return;

    const id = payload.data && payload.data.id;
    await self.registration.showNotification(payload.title || 'Queue update', {
      body: payload.body || '',
      // A tag is REQUIRED when renotify is true: browsers reject the notification otherwise.
      // It also makes a new alert for the same ticket replace the old one instead of piling up.
      tag: payload.tag || (id ? `ticket-${id}` : 'queue'),
      renotify: true,
      requireInteraction: payload.type === 'called',
      vibrate: [300, 150, 300],
      icon: '/img/sti-logo-sm.png',
      data: payload.data || {},
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const page = windows.find(w => /\/kiosk/.test(w.url)) || windows[0];
    if (page) { await page.focus(); return; }
    await self.clients.openWindow('/kiosk.html');
  })());
});
