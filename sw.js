const CACHE_VERSION = 'listino-v21';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './logo.svg',
  './info-icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests so we don't attempt to cache POST/PUT bodies
  if (request.method !== 'GET') return;

  if (url.hostname.endsWith('supabase.co')) return;

  if (url.pathname.endsWith('/admin-manage.js') && !url.searchParams.has('source')) {
    event.respondWith(adminManageWithoutReload(url));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  if (request.destination === 'script' || request.destination === 'style') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function adminManageWithoutReload(url) {
  const sourceUrl = new URL(url.href);
  sourceUrl.searchParams.set('source', '1');
  const response = await fetch(sourceUrl.toString(), { cache: 'no-store' });
  let code = await response.text();
  code = code.replace(
    "      await loadHistory();\n      setTimeout(() => window.location.reload(), 900);",
    "      if (data.product) fillForm(data.product);\n      if (data.product?.codice) $('adminOriginalCode').value = data.product.codice;\n      await loadHistory();"
  );
  code = code.replace(
    "      await loadHistory();\n      setTimeout(() => window.location.reload(), 1200);",
    "      await loadHistory();"
  );
  return new Response(code, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (request.method === 'GET' && response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_VERSION);
  const cacheKey = fallbackUrl ? new Request(fallbackUrl) : request;
  try {
    const response = await fetch(request);
    if (request.method === 'GET' && response && response.ok) {
      cache.put(cacheKey, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const networkFetch = fetch(request)
    .then((response) => {
      if (request.method === 'GET' && response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || networkFetch;
}
