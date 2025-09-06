self.addEventListener('install', (e) => {e.waitUntil(caches.open('listino-v2').then(c=>c.addAll(['./','./index.html','./script.js','./manifest.webmanifest'])))});
self.addEventListener('fetch', (e) => {const u=new URL(e.request.url); if(u.hostname.endsWith('supabase.co')) return; e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});
