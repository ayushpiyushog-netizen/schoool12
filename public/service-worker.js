self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (error) {
      console.error('Could not parse push notification payload:', error);
    }
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'B.S.M.P School', {
    body: payload.body || 'A new school notice is available.',
    icon: '/icons/school-crest.png',
    badge: '/icons/school-crest.png',
    tag: 'school-announcement',
    data: { url: payload.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url === targetUrl);
    if (existing) return existing.focus();
    return self.clients.openWindow(targetUrl);
  }));
});
