const CACHE_NAME = 'bernaudio-field-shell-v1';
const SHELL = ['./app.html', './manifest.webmanifest', './assets/favicon.svg'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(SHELL.map(path => cache.add(path)));
    try {
      const response = await fetch('./app.html', { cache: 'reload' });
      if (response.ok) {
        await cache.put('./app.html', response.clone());
        const html = await response.text();
        const assets = [...html.matchAll(/(?:src|href)=["']((?:js|css|assets)\/[^"']+)["']/g)]
          .map(match => match[1]);
        assets.push('js/app/capture-worklet.js?v=48be96b12ebd');
        await Promise.allSettled(assets.map(path => cache.add(path)));
      }
    } catch (_) {
      // Keep the shell that could be cached; a network connection is needed for first install.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('bernaudio-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isDocument = request.mode === 'navigate' || url.pathname.endsWith('/app.html') || url.pathname.endsWith('/index.html');
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (isDocument) {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) await cache.put(request, fresh.clone());
        return fresh;
      } catch (_) {
        return (await cache.match(request)) || (await cache.match('./app.html')) || Response.error();
      }
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      if (fresh.ok && url.pathname.match(/\.(?:js|css|svg|png|webp|woff2?)$/)) await cache.put(request, fresh.clone());
      return fresh;
    } catch (_) {
      return Response.error();
    }
  })());
});
