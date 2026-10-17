// Field Cam service worker — lets the app start with no signal.
//
// - The page (index.html) is network-first with a short timeout, so updates
//   arrive as soon as there's a connection but a weak signal falls back to cache.
// - Libraries from the CDNs are cache-first (their URLs are versioned).
// - Firebase / weather / map-tile traffic is never touched: data goes through
//   the in-app offline outbox and Firestore's own cache.
//
// Bump CACHE when this file's caching changes or the page's library/font URLs change,
// so installed copies re-cache them.

const CACHE = 'fieldcam-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
const CDN_HOSTS = [
    'cdn.tailwindcss.com', 'unpkg.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net',
    'fonts.googleapis.com', 'fonts.gstatic.com'
];
const NAV_TIMEOUT_MS = 4000;

const isCdn = (url) =>
    CDN_HOSTS.includes(url.hostname) ||
    (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));

// CORS where the CDN allows it (needed for the Firebase ES modules), opaque otherwise
async function fetchForCache(url) {
    try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (res.ok) return res;
    } catch (e) { /* fall through */ }
    return fetch(url, { mode: 'no-cors', credentials: 'omit' });
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await Promise.all(SHELL.map(u => cache.add(u).catch(() => {})));
        // Pre-cache every library the page references so the very first visit
        // is enough to work offline afterwards
        try {
            const html = await (await caches.match('./index.html'))?.text() || '';
            const urls = new Set();
            for (const m of html.matchAll(/(?:src|href)="(https:\/\/[^"]+)"/g)) urls.add(m[1]);
            for (const m of html.matchAll(/from\s+"(https:\/\/[^"]+)"/g)) urls.add(m[1]);
            await Promise.all([...urls].filter(u => isCdn(new URL(u))).map(async u => {
                try { await cache.put(u, await fetchForCache(u)); } catch (e) { /* best effort */ }
            }));
        } catch (e) { /* best effort */ }
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
        await self.clients.claim();
    })());
});

async function networkFirst(request) {
    const cache = await caches.open(CACHE);
    const network = fetch(request).then(res => {
        if (res.ok) cache.put(request, res.clone());
        return res;
    });
    const timeout = new Promise(resolve => setTimeout(resolve, NAV_TIMEOUT_MS));
    const fast = await Promise.race([network.catch(() => null), timeout]);
    if (fast) return fast;
    const cached = await cache.match(request, { ignoreSearch: true })
        || (request.mode === 'navigate' && await cache.match('./index.html'));
    return cached || network;   // nothing cached yet: keep waiting on the network
}

async function cacheFirst(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const res = await fetch(request);
    if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
    return res;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin === self.location.origin) {
        event.respondWith(networkFirst(request));
    } else if (isCdn(url)) {
        event.respondWith(cacheFirst(request));
    }
    // Everything else (Firebase, weather, map tiles) goes straight to the network
});
