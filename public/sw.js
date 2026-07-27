/* TCH Workforce service worker.
 *
 * Deliberately does NOT intercept fetch. A caching service worker is the single
 * easiest way to brick a web app — users get served stale HTML pointing at
 * hashed bundles that no longer exist, and no amount of refreshing fixes it
 * because the SW is the thing answering. The app already handles staleness at
 * the app layer (useVersionCheck prompts to reload after a deploy), so this
 * worker exists for one reason: to receive push while the app is closed.
 *
 * Offline support can be added later as a considered piece of work. It is not
 * a freebie that comes along with push.
 */

self.addEventListener('install', () => {
  // take over immediately rather than waiting for every tab to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'TCH Workforce', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'TCH Workforce';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    // Android's status bar renders ONLY the badge's alpha silhouette — a
    // full-color icon here shows as a white square. This is the chip mark
    // as white-on-transparent, so the suits read as cutouts.
    badge: '/icons/badge-96.png',
    // tag collapses repeats of the same thing (e.g. a re-sent shift reminder)
    // instead of stacking five identical banners
    tag: payload.tag || undefined,
    renotify: !!payload.tag,
    data: { url: payload.url || '/' },
    timestamp: Date.now(),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse a window that's already open — opening a second copy of the app
    // when one is sitting behind the lock screen is disorienting.
    for (const client of all) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) {
          try { await client.navigate(target); } catch { /* cross-origin or blocked; focus is enough */ }
        }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
