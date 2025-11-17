self.addEventListener('install', (ev) => {
  self.skipWaiting();
});
self.addEventListener('activate', (ev) => {
  self.clients.claim();
});

// handle push
self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: 'Notification', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Notification';
  const options = {
    body: payload.body || '',
    data: payload.data || {},
    tag: payload.tag || undefined,
    renotify: true
  };

  // show notification via service worker registration (works when page closed)
  event.waitUntil(self.registration.showNotification(title, options));

  // also notify any open client pages so they can update UI immediately
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const c of allClients) {
      try { c.postMessage({ type: payload.type || 'push', payload }); } catch (err) {}
    }
  })());
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    // focus first client or open root
    const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    if (allClients.length > 0) {
      allClients[0].focus();
      try { allClients[0].postMessage({ type: 'notificationclick', data }); } catch(e){}
    } else {
      self.clients.openWindow('/');
    }
  })());
});

self.addEventListener('message', (ev) => {
  // currently no special message handling; can echo for debug
});
