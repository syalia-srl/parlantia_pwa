/**
 * Parlantia SW v6.5 (Caché de Audio e Imágenes Agresivo)
 */

importScripts('assets/workbox/workbox-sw.js');

workbox.setConfig({ modulePathPrefix: 'assets/workbox/' });

const { registerRoute } = workbox.routing;
const { CacheFirst, NetworkFirst } = workbox.strategies;
const { CacheableResponsePlugin } = workbox.cacheableResponse;
// const { RangeRequestsPlugin } = workbox.rangeRequests;
const { ExpirationPlugin } = workbox.expiration;

// CATÁLOGO
registerRoute(
    ({ request }) => request.url.endsWith('.json'),
    new NetworkFirst({ cacheName: 'parlantia-data-v6', networkTimeoutSeconds: 2 })
);

// AUDIOS (Soporta MP3 y M4B con Range Requests para audios largos)
// AUDIOS (Motor Manual para Range Requests a prueba de fallos)
registerRoute(
    ({ request, url }) => request.destination === 'audio' || url.pathname.endsWith('.mp3') || url.pathname.endsWith('.m4b'),
    async ({ request, url }) => {
        try {
            const cache = await caches.open('parlantia-audio-v6');
            
            // 1. Buscamos el audio en el búnker ignorando parámetros raros
            const cachedResponse = await cache.match(request, { ignoreSearch: true }) || 
                                   await cache.match(url.href, { ignoreSearch: true });
            
            if (cachedResponse) {
                // 2. Si el reproductor del móvil pide un "pedazo" del audio (Range)
                const rangeHeader = request.headers.get('Range');
                if (rangeHeader) {
                    const blob = await cachedResponse.blob();
                    const size = blob.size;
                    
                    // Extraemos los bytes exactos que pide el móvil
                    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
                    let start = 0;
                    let end = size - 1;
                    
                    if (match) {
                        if (match[1]) start = parseInt(match[1], 10);
                        if (match[2]) end = parseInt(match[2], 10);
                    }

                    // Picamos el audio
                    const slicedBlob = blob.slice(start, end + 1);
                    
                    // 3. Le devolvemos el pedazo exacto forzando el formato a MP3
                    return new Response(slicedBlob, {
                        status: 206,
                        statusText: 'Partial Content',
                        headers: {
                            'Content-Type': 'audio/mpeg', // ¡Esto mata el NotSupportedError!
                            'Content-Range': `bytes ${start}-${end}/${size}`,
                            'Content-Length': slicedBlob.size,
                            'Accept-Ranges': 'bytes'
                        }
                    });
                }
                
                // Si no pide pedazo, devolvemos el audio entero
                return cachedResponse;
            }
            
            // 4. Si no está descargado, lo busca en internet
            return await fetch(request);
            
        } catch (error) {
            console.error("Fallo crítico sirviendo audio offline:", error);
            return new Response('', { status: 503, statusText: 'Offline' });
        }
    }
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