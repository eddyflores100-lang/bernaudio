const CACHE_NAME = 'bernaudio-field-shell-v2';
const APP_SHELL = [
  './app.html',
  './manifest.webmanifest',
  './assets/favicon.svg',
  './assets/pwa-icon.svg'
];
const STATIC_ASSET = /\.(?:js|css|svg|png|webp|ico|woff2?)$/i;

async function fetchAndCache(cache, path, scope) {
  const url = new URL(path, scope);
  if (url.origin !== self.location.origin || !STATIC_ASSET.test(url.pathname)) return null;
  try {
    const response = await fetch(url.href, { cache: 'reload', credentials: 'same-origin' });
    if (!response.ok || response.type === 'opaque') return null;
    await cache.put(url.href, response.clone());
    return { url: url.href, response };
  } catch (_) {
    return null;
  }
}

async function precacheApplication(cache) {
  const scope = self.registration.scope;
  const pageUrl = new URL('./app.html', scope).href;
  const pageResponse = await fetch(pageUrl, { cache: 'reload', credentials: 'same-origin' });
  if (!pageResponse.ok) throw new Error('BernAudio shell could not be downloaded.');
  await cache.put(pageUrl, pageResponse.clone());

  const html = await pageResponse.text();
  const queue = [];
  for (const match of html.matchAll(/(?:src|href)=["']((?:js|css|assets)\/[^"']+)["']/g)) {
    queue.push(match[1]);
  }

  // AudioWorklet and analysis workers are loaded dynamically by the app, not HTML tags.
  const seen = new Set();
  while (queue.length) {
    const path = queue.shift();
    const url = new URL(path, scope);
    if (url.origin !== self.location.origin || !STATIC_ASSET.test(url.pathname) || seen.has(url.href)) continue;
    seen.add(url.href);
    const cached = await fetchAndCache(cache, url.href, scope);
    if (!cached || !url.pathname.endsWith('.js')) continue;

    const source = await cached.response.clone().text();
    for (const match of source.matchAll(/addModule\(["']([^"']+)["']\)/g)) {
      queue.push(new URL(match[1], scope).href);
    }
    for (const match of source.matchAll(/new URL\(["']([^"']+\.js[^"']*)["']/g)) {
      queue.push(new URL(match[1], scope).href);
    }
    for (const match of source.matchAll(/importScripts\(["']([^"']+)["']\)/g)) {
      queue.push(new URL(match[1], url).href);
    }
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const path of APP_SHELL) {
      try { await cache.add(path); } catch (_) {}
    }
    try {
      await precacheApplication(cache);
    } catch (_) {
      // First launch needs a network connection; keep any successfully cached shell resources.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('bernaudio-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isDocument = request.mode === 'navigate' ||
    url.pathname.endsWith('/app.html') || url.pathname.endsWith('/index.html');

  if (!isDocument && !STATIC_ASSET.test(url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (isDocument) {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) await cache.put(request, fresh.clone());
        return fresh;
      } catch (_) {
        return (await cache.match(request)) ||
          (await cache.match(new URL('./app.html', self.registration.scope).href)) ||
          Response.error();
      }
    }

    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      if (fresh.ok && fresh.type !== 'opaque') await cache.put(request, fresh.clone());
      return fresh;
    } catch (_) {
      return Response.error();
    }
  })());
});
