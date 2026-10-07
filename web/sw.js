// App shell cache so Monat opens without a connection. The data itself is kept by the page
// (last good /api/state in localStorage); API calls always go to the network.
const VERSION = 'monat-v6';
const SHELL = [
  '/', '/css/app.css', '/manifest.webmanifest', '/icons/apple-touch-icon.png', '/icons/icon-192.png',
  '/js/app.js', '/js/ui.js', '/js/vendor/preact-htm.js',
  '/js/lib/format.js', '/js/lib/icons.js', '/js/lib/charts.js', '/js/lib/budget.js', '/js/lib/rules.js',
  '/js/screens/home.js', '/js/screens/category.js', '/js/screens/transactions.js', '/js/screens/inbox.js',
  '/js/screens/txn.js', '/js/screens/budgets.js', '/js/screens/settings.js', '/js/screens/login.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first, so a deploy shows up on the next launch; the cache is the offline fallback.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// Alerts from the server (app/alerts.py). iOS requires every push to show a notification.
self.addEventListener('push', e => {
  let n;
  try { n = e.data.json(); } catch { n = { title: 'Monat', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(n.title || 'Monat', {
    body: n.body || '', tag: n.tag, data: { target: n.target || null }, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
  }));
});

// Tapping one opens Monat on the screen it's about: an open window is told where to go, otherwise a new one starts there.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.target || null;
  e.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      try { await w.focus(); } catch { /* not allowed to focus; still tell it */ }
      w.postMessage({ open: target });
      return;
    }
    await clients.openWindow(target ? '/?open=' + encodeURIComponent(target) : '/');
  })());
});
