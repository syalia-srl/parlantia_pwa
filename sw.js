/**
 * Parlantia SW v6.5 (Caché de Audio e Imágenes Agresivo)
 */

importScripts('assets/workbox/workbox-sw.js');

workbox.setConfig({ modulePathPrefix: 'assets/workbox/' });

const { registerRoute } = workbox.routing;
const { CacheFirst, NetworkFirst } = workbox.strategies;
const { CacheableResponsePlugin } = workbox.cacheableResponse;
const { RangeRequestsPlugin } = workbox.rangeRequests;
const { ExpirationPlugin } = workbox.expiration;

// CATÁLOGO
registerRoute(
    ({ request }) => request.url.endsWith('.json'),
    new NetworkFirst({ cacheName: 'parlantia-data-v6', networkTimeoutSeconds: 2 })
);

// AUDIOS (Soporta MP3 y M4B con Range Requests para audios largos)
registerRoute(
    ({ request, url }) => request.destination === 'audio' || url.pathname.endsWith('.mp3') || url.pathname.endsWith('.m4b'),
    new CacheFirst({
        cacheName: 'parlantia-audio-v6',
        plugins: [
            new CacheableResponsePlugin({ statuses: [0, 200, 206] }),
            new RangeRequestsPlugin(), 
            new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 }),
        ],
    })
);

registerRoute(
    ({ request }) => ['document', 'script', 'style'].includes(request.destination),
    new NetworkFirst({ 
        cacheName: 'parlantia-app-shell',
        networkTimeoutSeconds: 3 // Si en 3 seg no hay red buena, carga offline al toque
    })
);

// 2. LAS IMÁGENES -> CacheFirst
// Las carátulas pesan mucho y cambian poco, se quedan en caché blindado.
registerRoute(
    ({ request }) => request.destination === 'image',
    new CacheFirst({ 
        cacheName: 'parlantia-images-v6',
        plugins: [
            new CacheableResponsePlugin({ statuses: [0, 200] }), 
            new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 })
        ],
    })
);

console.log('Parlantia SW Activo. Audios e Imágenes en Búnker.');