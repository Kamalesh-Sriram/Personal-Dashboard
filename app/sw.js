/* ══════════════════════════════════════════════════════════════════════
   SERVICE WORKER

   1. Offline: every same-origin file is fetched from the network first
      and the copy is kept; if the network is gone, the kept copy is
      served. Network-first on purpose: a cache-first worker pins old
      code, and two devices on different builds disagree about data.

   2. Push: receives notifications sent by the site's own Netlify function
      and shows them, including when the app is closed.

   It never caches the Netlify functions, and never touches other origins.
   ══════════════════════════════════════════════════════════════════════ */
const CACHE = 'hq-v5';
const SHELL = ['./', 'css/tokens.css', 'css/app.css', 'css/views.css', 'js/boot-theme.js', 'js/main.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/.netlify/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === 'basic') cache.put(req, fresh.clone());
      return fresh;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./') : null);
      return hit || new Response('Offline, and this file has not been saved yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});

/* ── push ── */
async function hasVisibleWindow() {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return list.some(c => c.visibilityState === 'visible');
}
const ICON = 'icons/icon-192.png', BADGE = 'icons/badge-96.png';

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let msg = {};
    try { msg = event.data ? event.data.json() : {}; } catch { /* use defaults */ }
    const tag = String(msg.tag || 'hq').slice(0, 60);
    const title = String(msg.title || 'Dashboard').slice(0, 120), body = String(msg.body || '').slice(0, 400);

    // The timer stopped: take the ongoing notice down. A push must end with
    // something visible unless a window is on screen, so post a quiet line.
    if (msg.kind === 'timer_clear') {
      (await self.registration.getNotifications({ tag })).forEach(n => n.close());
      if (await hasVisibleWindow()) return;
      await self.registration.showNotification(title, { body, tag: tag + ':done', icon: ICON, badge: BADGE, silent: true, data: { url: './' } });
      return;
    }
    // If the app is on screen it shows its own toast; a second copy is noise.
    if (msg.kind !== 'timer' && await hasVisibleWindow()) return;

    await self.registration.showNotification(title, {
      body, tag, icon: ICON, badge: BADGE,
      renotify: msg.kind !== 'timer',          // a refreshed timer must not buzz every time
      silent: !!msg.silent,
      requireInteraction: !!msg.ongoing,
      timestamp: Date.now(),
      data: { kind: msg.kind, url: './' }
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin) { await c.focus(); c.postMessage({ type: 'notification-click' }); return; }
    }
    await self.clients.openWindow('./');     // always our own origin: never a URL from the payload
  })());
});
