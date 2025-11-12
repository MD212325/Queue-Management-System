self.addEventListener('install', (e) => { self.skipWaiting(); console.log('[sw] installed'); });
self.addEventListener('activate', (e) => { clients.claim(); console.log('[sw] activated'); });

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch(e) { payload = { body: event.data ? event.data.text() : 'Update' }; }
  const title = payload.title || 'Queue update';
  const body = payload.body || payload.text || 'Please check the queue';
  const data = payload.data || payload;
  const options = {
    body,
    tag: payload.tag || 'queue-update',
    renotify: true,
    silent: false,
    vibrate: [80, 40, 80],
    badge: '/favicon.ico',
    data
  };

  event.waitUntil(self.registration.showNotification(title, options));

  event.waitUntil(
    clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(windowClients => {
      for (const client of windowClients) {
        try { client.postMessage({ type: 'call', token: data.token, service: data.service, body }); } catch(e){}
      }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url && 'focus' in client) return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
