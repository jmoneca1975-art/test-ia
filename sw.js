const CACHE_NAME = 'test-app-v50';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './ai-service.js',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&family=Outfit:wght@400;600;800&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log("SW: Precaching assets...");
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log("SW: Deleting old cache:", key);
                        return caches.delete(key);
                    }
                })
            );
        })
    );
});

// ESTRATEGIA: Network First (Prioriza red para actualizaciones rápidas)
self.addEventListener('fetch', (event) => {
    // Ignorar peticiones de chrome-extension o esquemas no soportados
    if (!event.request.url.startsWith('http')) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Si la red responde bien, actualizamos el cache
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return response;
            })
            .catch(() => {
                // Si falla la red (offline), tiramos del cache
                return caches.match(event.request);
            })
    );
});
