// Service worker: network-first for everything same-origin (so a deploy is never stale),
// cache fallback so the game still opens and plays offline after one online visit.
// Bump CACHE when the caching strategy itself changes; content updates need no bump.
// version.json (written by the Pages workflow) goes through the same network-first path, so the in-app 'update available'
// check (js/ui/version.js) always sees the live deploy while online and the last known one offline.
const CACHE = 'ptgame-v3';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/style.css', 'css/ui.css', 'css/mobile.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/icon.svg',
  'assets/art/atlas.json', 'assets/art/atlas.png'];   // sprite atlas: precached (optional: the game falls back to the procedural art)
const NET_TIMEOUT = 5000;   // slow mobile networks: fall back to the cache after this long

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => { /* optional */ })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k.startsWith('ptgame-')) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const key = req.mode === 'navigate' ? 'index.html' : req;
  try {
    const res = await Promise.race([
      fetch(req, { cache: 'no-cache' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NET_TIMEOUT)),
    ]);
    if (res && res.ok && res.type === 'basic') cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(key, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./') : null);
    if (hit) return hit;
    return new Response('離線中，且尚未快取這個檔案。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
