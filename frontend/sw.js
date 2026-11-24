const CACHE_NAME = 'sgstock-shell-v20';
const APP_SHELL = [
    '/home',
    '/login',
    '/style.css?v=10',
    '/script.js?v=17',
    '/auth.js',
    '/login.js',
    '/qrcode.js',
    '/ocr-assets/tesseract.min.js',
    '/ocr.js?v=18',
    '/manifest.json',
    '/pwa-icon.svg',
    '/MoRENet_Logo.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys
                .filter(key => key.startsWith('sgstock-') && key !== CACHE_NAME)
                .map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method !== 'GET' || url.origin !== self.location.origin ||
        url.pathname.startsWith('/api/')) {
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            try {
                const response = await fetch(request);
                if (response.ok && ['/home', '/login'].includes(url.pathname)) {
                    await cache.put(url.pathname, response.clone());
                }
                return response;
            } catch (error) {
                const fallbackPath = url.pathname === '/' ? '/home' : url.pathname;
                const cached = await cache.match(request) || await cache.match(fallbackPath);
                if (cached) return cached;
                throw error;
            }
        })());
        return;
    }

    const isAppShell = APP_SHELL.some(asset => new URL(asset, self.location.origin).pathname === url.pathname);
    const isOcrAsset = url.pathname.startsWith('/ocr-assets/');
    if (!isAppShell && !isOcrAsset) return;

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        const network = fetch(request).then(response => {
            if (response.ok && response.type === 'basic') {
                cache.put(request, response.clone());
            }
            return response;
        });

        if (cached) {
            event.waitUntil(network.catch(() => undefined));
            return cached;
        }

        return network;
    })());
});
