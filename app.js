/**
 * Parlantia Core v6.5 - Memoria, Feedback, Gestión y Partes Corregidas
 */

// Generador de Hash seguro para strings (No explota con tildes y evita colisiones)
function getSafeHashId(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0; // Convertir a entero de 32 bits
    }
    return 'track-' + Math.abs(hash).toString(36);
}

const generateQueueId = () => Math.random().toString(36).substr(2, 9);
let catalog = [];
let allTracks = [];
let fuse;
let myList = JSON.parse(localStorage.getItem('parlantia_playlist')) || [];
let myLibraryBooks = JSON.parse(localStorage.getItem('parlantia_library')) || [];
let sleepTimerId = null;
let currentViewedBookId = null; // Para saber qué libro estamos mirando
let activeDownloads = {};

myList.forEach(item => { if (!item.id) item.id = generateQueueId(); });


let currentPlayingUrl = localStorage.getItem('parlantia_last_played') || null;
let currentPlayingItemId = localStorage.getItem('parlantia_last_played_id') || null; // NUEVO: Rastrea la instancia exacta de la cola
let trackProgress = JSON.parse(localStorage.getItem('parlantia_progress')) || {};
let activeDownloadToast = null;


const audio = document.getElementById('main-audio');
const progBar = document.getElementById('progress-bar');

document.addEventListener('DOMContentLoaded', () => {
    loadCatalog();
    initPlayerEvents();
    restorePlayerState();
    showTab('playlist');
});

// 1. EL TOAST INTELIGENTE (Ahora sí soporta tiempo infinito y devuelve el elemento)
function showToast(msg, duration = 2500) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = msg;
    container.appendChild(toast);

    // Si la duración es mayor a 0, se borra solo. Si es 0, se queda fijo.
    if (duration > 0) {
        setTimeout(() => toast.remove(), duration);
    }
    return toast; // VITAL: Devolvemos el elemento para borrarlo cuando cargue
}

// --- INICIALIZACIÓN Y CATÁLOGO ---
async function loadCatalog() {
    try {
        const response = await fetch('catalogo.json', { cache: 'no-cache' });
        catalog = await response.json();
        flattenCatalog(catalog);
        if (typeof Fuse !== 'undefined') fuse = new Fuse(allTracks, { keys: ['title', 'context'], threshold: 0.4 });
        if (document.getElementById('view-library').style.display === 'block') renderLibrary();
    } catch (e) { showToast("Modo Offline"); }
}

function flattenCatalog(data) {
    allTracks = [];
    data.forEach(book => {
        const meta = { author: book.author, cover: book.coverUrl };

        allTracks.push({ type: 'book', id: book.id, title: book.title, ...meta });

        if (book.audioUrl) allTracks.push({ type: 'track', title: book.title, url: book.audioUrl, ...meta, context: book.title });

        if (book.units) book.units.forEach(u => allTracks.push({ type: 'track', title: u.title, url: u.audioUrl, ...meta, context: book.title }));

        // CORRECCIÓN: Respetar la carátula específica de las partes (Ej. Edad de Oro)
        if (book.parts) {
            book.parts.forEach(p => {
                const partMeta = { author: book.author, cover: p.coverUrl || book.coverUrl };
                p.units.forEach(u => allTracks.push({ type: 'track', title: u.title, url: u.audioUrl, ...partMeta, context: `${book.title} - ${p.title}` }));
            });
        }
    });
}

function restorePlayerState() {
    if (currentPlayingUrl) {
        // Primero intentamos recuperar la instancia exacta por ID
        let savedTrack = currentPlayingItemId ? myList.find(t => t.id === currentPlayingItemId) : null;

        // Si no existe (o se borró), buscamos la primera coincidencia por URL
        if (!savedTrack) {
            savedTrack = myList.find(t => t.url === currentPlayingUrl) || allTracks.find(t => t.url === currentPlayingUrl);
        }

        if (savedTrack) {
            document.getElementById('track-title').innerText = savedTrack.title;
            document.getElementById('track-title').style.color = "var(--brand-blue)";
            audio.src = savedTrack.url;

            let progressKey = savedTrack.id || savedTrack.url;
            if (trackProgress[progressKey]) {
                audio.currentTime = trackProgress[progressKey];
                progBar.value = (audio.currentTime / audio.duration) * 100 || 0;
            }
        }
    }
    updatePlayerButtons();
}

function showTab(id) {
    document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
    document.getElementById(`view-${id}`).style.display = 'block';
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-${id}`).classList.add('active');

    // Refrescos automáticos al cambiar de pestaña
    if (id === 'library') renderLibrary();
    if (id === 'playlist') renderPlaylist();
    if (id === 'downloads') renderDownloadsTab();
    
    // --- ESTA ES LA PARTE QUE TE FALTA ---
    if (id === 'search') {
        const input = document.getElementById('search-input');
        // Si hay algo escrito en el buscador, refrescamos los resultados
        if (input && input.value) {
            handleSearch({ target: { value: input.value } });
        }
    }
    syncOfflineUI();
}

function refreshActiveViews() {
    // 1. Refrescar Lista de reproducción (Mi Lista)
    if (document.getElementById('view-playlist').style.display === 'block') {
        renderPlaylist();
    }
    // 2. Refrescar Biblioteca (rejilla principal)
    if (document.getElementById('view-library').style.display === 'block' &&
        document.getElementById('library-grid-container').style.display !== 'none') {
        renderLibrary();
    }
    // 3. Refrescar Buscador
    if (document.getElementById('view-search').style.display === 'block') {
        const input = document.getElementById('search-input');
        if (input && input.value) handleSearch({ target: { value: input.value } });
    }
    // 4. Refrescar Detalle del Libro (si está abierto)
    if (document.getElementById('book-detail-view').style.display === 'block' && currentViewedBookId) {
        showBookDetail(currentViewedBookId);
    }

    // 👇 NUEVO: 5. Refrescar el Tab de Descargas para que los botones se desbloqueen
    if (document.getElementById('view-downloads').style.display === 'block') {
        renderDownloadsTab();
    }

    updatePlayerButtons();
    syncOfflineUI();
}

function handleSearch(e) {
    const term = e.target.value.toLowerCase();
    const container = document.getElementById('search-results');
    if (!term.trim()) { container.innerHTML = ''; return; }

    let results = fuse ? fuse.search(term).map(r => r.item) : allTracks.filter(t => t.title.toLowerCase().includes(term));

    container.innerHTML = results.map(i => {
        if (i.type === 'book') {
            const inLib = myLibraryBooks.map(String).includes(String(i.id));
            
            // Icono limpio para "Añadir" (Libro con +)
            const iconAdd = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:block;"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z"/></svg>`;
            
            // Icono limpio para "Añadido" (Check)
            const iconCheck = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:block;"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>`;

            return `<div class="playlist-item" style="border-left:4px solid var(--brand-orange);">
                <strong style="flex:1;">${i.title}</strong>
                <button class="btn-small" 
                        style="display:flex; align-items:center; justify-content:center; padding:8px; opacity: ${inLib ? '0.5' : '1'}; transition: opacity 0.2s;" 
                        onclick="addToLibrary('${i.id}')" ${inLib ? 'disabled' : ''}>
                    ${inLib ? iconCheck : iconAdd}
                </button>
            </div>`;
        }
        return renderRow(i.title, i.url);
    }).join('');

    markOfflineTracks();
    syncOfflineUI();    
}

function renderRow(title, url) {
    const count = getQueueCount(url);
    const trackId = getSafeHashId(url); // Hash seguro y único

    return `
        <div class="track-row" style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid #eee;">
            <div style="flex:1; min-width:0; padding-right:10px;">
                <span style="font-size:0.9rem; font-weight:500; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${title}</span>
                <div style="display:flex; gap:5px; align-items:center; margin-top: 4px;">
                    <span class="offline-badge ${trackId}" style="display:none;">⚡ OFFLINE</span>
                    ${count > 0 ? `<span class="queue-badge" style="background:var(--brand-orange); color:white; font-size:0.6rem; padding:1px 5px; border-radius:10px; font-weight:bold;">${count}x en lista</span>` : ''}
                </div>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="btn-small play-btn-smart" data-url="${url}" onclick="playFromCatalog('${url}','${title}')">▶️</button>
                <button class="btn-small" onclick="addToPlaylist('${title}','${url}')">➕</button>
            </div>
        </div>`;
}

async function markOfflineTracks() {
    try {
        const cache = await caches.open('parlantia-audio-v6');
        const keys = await cache.keys();

        // Extraemos las respuestas reales para poder ver si son "pedazos" (206) o archivos completos (200 o 0)
        const cachedItems = await Promise.all(keys.map(async k => {
            const res = await cache.match(k);
            return { url: k.url, status: res ? res.status : null };
        }));

        const tracks = allTracks.filter(t => t.url);
        for (const t of tracks) {
            // Sacamos el nombre limpio (ej: "Nuestra_América.m4b")
            let fName = t.url;
            try { fName = decodeURIComponent(t.url).split('/').pop().split('?')[0]; }
            catch (e) { fName = t.url.split('/').pop().split('?')[0]; }

            // REGLA DE ORO: Tiene que estar en la bóveda Y su estatus NO puede ser 206
            const isFullyOffline = cachedItems.some(item => {
                let matchUrl = item.url;
                try { matchUrl = decodeURIComponent(item.url); } catch (e) { }
                return (matchUrl.includes(fName) || item.url.includes(fName)) && item.status !== 206;
            });

            const trackId = getSafeHashId(t.url);
            const badges = document.querySelectorAll(`.${trackId}`);
            badges.forEach(b => b.style.display = isFullyOffline ? 'inline-flex' : 'none');
        }
    } catch (e) {
        console.warn("Error chequeando caché", e);
    }
}

// --- BIBLIOTECA Y DETALLE (CORREGIDOS) ---
function renderLibrary() {
    const container = document.getElementById('library-grid-container');
    const controls = document.querySelector('.library-controls');
    const filterTerm = document.getElementById('library-filter').value.toLowerCase();
    const sortType = document.getElementById('library-sort').value;

    // NUEVO: El sistema se asoma a ver si el detalle del libro está abierto
    const isInsideBook = document.getElementById('book-detail-view').style.display === 'block';

    if (myLibraryBooks.length === 0) {
        if (controls) controls.style.display = 'none'; 
        container.innerHTML = `<div class="empty-state">
            <h2 class="empty-title">Tu biblioteca está vacía</h2>
            <button onclick="showTab('search')" class="btn-massive">🔍 Explorar Catálogo</button>
        </div>`;
        return;
    }

    // MAGIA CORREGIDA: Solo mostramos la barra si NO estamos adentro de un libro
    if (controls) {
        if (isInsideBook) {
            controls.style.display = 'none';
        } else {
            controls.style.display = 'flex';
        }
    }

    // Asegurar comparación por String
    let saved = catalog.filter(b => myLibraryBooks.map(String).includes(String(b.id)));

    if (filterTerm) {
        saved = saved.filter(b => b.title.toLowerCase().includes(filterTerm) || b.author.toLowerCase().includes(filterTerm));
    }

    saved.sort((a, b) => {
        if (sortType === 'title_az') return a.title.localeCompare(b.title);
        if (sortType === 'title_za') return b.title.localeCompare(a.title);
        if (sortType === 'author_az') return a.author.localeCompare(b.author);
        if (sortType === 'author_za') return b.author.localeCompare(a.author);
        if (sortType === 'recent_asc') return myLibraryBooks.indexOf(String(a.id)) - myLibraryBooks.indexOf(String(b.id));
        return myLibraryBooks.indexOf(String(b.id)) - myLibraryBooks.indexOf(String(a.id));
    });

    container.innerHTML = `<div class="library-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
        ${saved.map(b => `
            <div class="cover-card" style="position: relative; background: #fff;">
                <button onclick="removeFromLibrary('${b.id}'); event.stopPropagation();" class="btn-delete-lib">✕</button>
                <div onclick="showBookDetail('${b.id}')">
                    <img src="${b.coverUrl}" 
                         crossorigin="anonymous" 
                         loading="eager"
                         style="width: 100%; aspect-ratio: 1/1; object-fit: cover; display: block;" 
                         onerror="this.src='assets/default-cover.png'">
                    <div class="cover-info">${b.title}</div>
                </div>
            </div>`).join('')}
    </div>`;

    markOfflineTracks();
}

window.showBookDetail = (id) => {
    const book = catalog.find(b => String(b.id) === String(id));
    if (!book) return;

    currentViewedBookId = id; 

    // 1. Limpieza de interfaz
    document.getElementById('library-grid-container').style.display = 'none';
    const headerActions = document.querySelector('.library-header-actions');
    const libraryControls = document.querySelector('.library-controls');
    if (headerActions) headerActions.style.display = 'none';
    if (libraryControls) libraryControls.style.display = 'none';

    const detail = document.getElementById('book-detail-view');
    detail.style.display = 'block';

    // 2. Construcción del HTML
    let html = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1.5rem;">
            <button onclick="closeBookDetail()" class="btn-back" style="margin:0;">← Volver</button>
            <div style="display:flex; gap:12px; align-items:center;">
                <button onclick="addBookToPlaylist('${id}')" class="btn-small" 
                        style="background:var(--brand-blue); color:white; padding:8px 16px; border-radius:30px; font-weight:700; border:none; box-shadow: 0 4px 10px rgba(26,26,90,0.2);">
                    ➕ Todo
                </button>
                
                <button onclick="removeFromLibrary('${id}')" class="btn-delete-lib" 
                        style="position: static; width: 35px; height: 35px; font-size: 1rem; box-shadow: 0 4px 10px rgba(211,47,47,0.3);">
                    ✕
                </button>
            </div>
        </div>

        <div class="detail-header">
            <img src="${book.coverUrl}" crossorigin="anonymous" class="detail-cover" onerror="this.src='assets/default-cover.png'">
            <div>
                <h2 class="detail-title">${book.title}</h2>
                <p style="color:var(--text-muted); font-size:0.9rem; margin-top:4px;">${book.author}</p>
            </div>
        </div>

        <div class="track-list" style="margin-top:10px;">
            ${book.audioUrl ? renderRow(book.title, book.audioUrl) : ''}
            ${book.units ? book.units.map(u => renderRow(u.title, u.audioUrl)).join('') : ''}
            
            ${book.parts ? book.parts.map(p => {
                // Ajuste solicitado: Botón azul, redondeado y con texto "➕ Todo"
                let partHtml = `
                <div style="margin-top: 20px; padding: 8px 12px; background: rgba(26,26,90,0.05); border-left: 4px solid var(--brand-orange); display:flex; justify-content:space-between; align-items:center; border-radius: 6px;">
                    <span style="font-weight: 800; font-size: 0.85rem; color: var(--brand-blue); text-transform: uppercase; letter-spacing:0.5px;">${p.title}</span>
                    <button onclick="addPartToPlaylist('${id}', '${p.title}')" class="btn-small" 
                            style="font-size:0.7rem; padding:6px 12px; background:var(--brand-blue); color:white; border-radius:30px; border:none; font-weight:700;">
                        ➕ Todo
                    </button>
                </div>`;
                partHtml += p.units.map(u => renderRow(u.title, u.audioUrl)).join('');
                return partHtml;
            }).join('') : ''}
        </div>`;

    detail.innerHTML = html;
    markOfflineTracks();
    syncOfflineUI();
};

function closeBookDetail() {
    currentViewedBookId = null;
    document.getElementById('book-detail-view').style.display = 'none';

    // Restaurar visibilidad de los controles superiores de la biblioteca
    const headerActions = document.querySelector('.library-header-actions');
    const libraryControls = document.querySelector('.library-controls');
    if (headerActions) headerActions.style.display = 'flex';
    if (libraryControls) libraryControls.style.display = 'flex';

    document.getElementById('library-grid-container').style.display = 'block';
    renderLibrary(); // Refrescar para asegurar que el orden y filtros se apliquen
    syncOfflineUI();
}

function addToLibrary(id) {
    if (!myLibraryBooks.map(String).includes(String(id))) {
        myLibraryBooks.push(String(id));
        localStorage.setItem('parlantia_library', JSON.stringify(myLibraryBooks));
        showToast("Libro guardado");
        refreshActiveViews();
    }
}

function removeFromLibrary(id) {
    const book = catalog.find(b => String(b.id) === String(id));
    const title = book ? book.title : "este libro";

    // Llamamos al modal personalizado en vez del confirm()
    showParlantiaModal(
        "Eliminar de Biblioteca",
        `¿Estás seguro de que deseas quitar "${title}" de tu biblioteca?`,
        "Quitar libro",
        true, // Botón rojo (destructivo)
        () => {
            // Esto es lo que pasa cuando el usuario hace clic en "Aceptar"
            myLibraryBooks = myLibraryBooks.filter(bId => String(bId) !== String(id));
            localStorage.setItem('parlantia_library', JSON.stringify(myLibraryBooks));
            showToast("Eliminado de tu biblioteca");

            if (document.getElementById('book-detail-view').style.display === 'block') {
                closeBookDetail();
            }
            refreshActiveViews();
        }
    );
}

function addToPlaylist(title, url) {
    myList.push({ id: generateQueueId(), title, url });
    localStorage.setItem('parlantia_playlist', JSON.stringify(myList));
    showToast("Añadido a la lista");
    refreshActiveViews();
}

let dragStartIndex = -1;
function dragStart(e, i) { dragStartIndex = i; setTimeout(() => e.target.style.opacity = '0.5', 0); }
function dragOver(e) { e.preventDefault(); }
function dragEnter(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function dragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function dragEnd(e) { e.target.style.opacity = '1'; document.querySelectorAll('.playlist-item').forEach(i => i.classList.remove('drag-over')); }
function drop(e, dropIndex) {
    e.preventDefault(); e.currentTarget.classList.remove('drag-over');
    if (dragStartIndex === -1 || dragStartIndex === dropIndex) return;
    const item = myList.splice(dragStartIndex, 1)[0];
    myList.splice(dropIndex, 0, item);
    localStorage.setItem('parlantia_playlist', JSON.stringify(myList));
    renderPlaylist();
}

function renderPlaylist() {
    const container = document.getElementById('playlist-container');
    if (!myList.length) {
        container.innerHTML = `<div class="empty-state"><h2 class="empty-title">Tu lista está vacía</h2><button onclick="showTab('search')" class="btn-massive">🔍 Buscar</button></div>`;
        updatePlayerButtons(); return;
    }

    container.innerHTML = ``; // Quitamos el título como pediste
    myList.forEach((t, i) => {
        const active = currentPlayingItemId === t.id;
        const trackId = getSafeHashId(t.url); 

        container.innerHTML += `
        <div class="playlist-item ${active ? 'active' : ''}" data-id="${t.id}" draggable="true" ondragstart="dragStart(event, ${i})" ondragover="dragOver(event)" ondragenter="dragEnter(event)" ondragleave="dragLeave(event)" ondragend="dragEnd(event)" ondrop="drop(event, ${i})">
            <div style="cursor:grab; font-size:1.4rem; color:var(--text-muted); padding-right:10px;">⋮⋮</div>
            <div style="flex:1; min-width:0;">
                <span style="display:block; font-weight:${active ? '700' : '500'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${t.title}</span>
                <div style="margin-top: 4px;">
                    <span class="offline-badge ${trackId}" style="display:none;">⚡ OFFLINE</span>
                </div>
            </div>
            
            <div style="display:flex; gap:10px; align-items:center;">
                <button class="btn-small play-btn-smart" data-url="${t.url}"
                        style="background:none; border:none; padding:0; font-size:1.2rem; cursor:pointer;" 
                        onclick="playTrack('${t.url}', '${t.title}', '${t.id}')">
                    ▶️
                </button>
                
                <button class="btn-delete-lib" 
                        style="position: static; width: 24px; height: 24px; font-size: 0.8rem; flex-shrink: 0; box-shadow: 0 2px 8px rgba(211,47,47,0.2);" 
                        onclick="removeFromPlaylist(${i})">
                    ✕
                </button>
            </div>
        </div>`;
    });

    updatePlayerButtons();
    markOfflineTracks();
}

function removeFromPlaylist(i) {
    const removedUrl = myList[i].url;
    myList.splice(i, 1);
    localStorage.setItem('parlantia_playlist', JSON.stringify(myList));
    if (removedUrl === currentPlayingUrl) {
        audio.pause(); currentPlayingUrl = null;
        document.getElementById('track-title').innerText = "Selecciona un audio";
        togglePlayIcons(false);
    }
    refreshActiveViews();
}

function addBookToPlaylist(id) {
    const book = catalog.find(b => String(b.id) === String(id));
    if (!book) return;

    let tracksToAdd = [];
    if (book.audioUrl) tracksToAdd.push({ title: book.title, url: book.audioUrl });
    if (book.units) book.units.forEach(u => tracksToAdd.push({ title: u.title, url: u.audioUrl }));
    if (book.parts) book.parts.forEach(p => p.units.forEach(u => tracksToAdd.push({ title: u.title, url: u.audioUrl })));

    // Asignamos un ID único a CADA pista en el momento de añadirla
    tracksToAdd.forEach(t => myList.push({ id: generateQueueId(), title: t.title, url: t.url }));
    localStorage.setItem('parlantia_playlist', JSON.stringify(myList));
    showToast(`Libro añadido (${tracksToAdd.length} pistas)`);
    refreshActiveViews();
}

function addPartToPlaylist(bookId, partTitle) {
    const book = catalog.find(b => String(b.id) === String(bookId));
    if (!book || !book.parts) return;
    const part = book.parts.find(p => p.title === partTitle);
    if (!part) return;

    part.units.forEach(u => myList.push({ id: generateQueueId(), title: u.title, url: u.audioUrl }));
    localStorage.setItem('parlantia_playlist', JSON.stringify(myList));
    showToast(`${part.title} añadida`);
    refreshActiveViews();
}
// --- REPRODUCTOR ---
let originalTitle = "";

function initPlayerEvents() {
    audio.ontimeupdate = () => {
        progBar.value = (audio.currentTime / audio.duration) * 100 || 0;
        document.getElementById('time-current').innerText = formatTime(audio.currentTime);
        if (currentPlayingUrl && audio.currentTime > 0) {
            let progressKey = currentPlayingItemId || currentPlayingUrl;
            trackProgress[progressKey] = audio.currentTime;
            localStorage.setItem('parlantia_progress', JSON.stringify(trackProgress));
        }
    };

    audio.onloadedmetadata = () => {
        document.getElementById('time-total').innerText = formatTime(audio.duration);
        // Respaldo seguro: Si no pudimos fijar el tiempo antes, lo hacemos ahora
        let progressKey = currentPlayingItemId || currentPlayingUrl;
        if (trackProgress[progressKey] && audio.currentTime === 0) {
            audio.currentTime = trackProgress[progressKey];
        }
    };

    audio.onended = () => {
        let progressKey = currentPlayingItemId || currentPlayingUrl;
        delete trackProgress[progressKey];
        localStorage.setItem('parlantia_progress', JSON.stringify(trackProgress));
        playNextInList();
    };

    // AVISOS VISUALES Y ACTUALIZACIÓN EN TIEMPO REAL
    const titleDisp = document.getElementById('track-title');

    // Si el internet es lento y se detiene a cargar a la mitad
    audio.addEventListener('waiting', () => {
        titleDisp.style.color = "var(--brand-orange)";
    });

    // Cuando el audio finalmente empieza a sonar (¡Magia aquí!)
    audio.addEventListener('playing', () => {
        titleDisp.style.color = "var(--brand-blue)";

        // El audio ya está sonando, quitamos el cartel de descarga fijo
        if (activeDownloadToast) {
            activeDownloadToast.remove();
            activeDownloadToast = null;
        }
    });
}


function updatePlayerButtons() {
    const idx = myList.findIndex(t => t.id === currentPlayingItemId);
    const btnP = document.getElementById('btn-prev'), btnN = document.getElementById('btn-next');
    btnP.disabled = (idx <= 0); btnP.style.opacity = idx <= 0 ? "0.3" : "1";
    btnN.disabled = (idx === -1 || idx >= myList.length - 1); btnN.style.opacity = (idx === -1 || idx >= myList.length - 1) ? "0.3" : "1";
}

function playTrack(url, title, queueId = null) {
    // 1. Configuración de controles en pantalla de bloqueo (Media Session)
    if ('mediaSession' in navigator) {
        const t = allTracks.find(track => track.url === url);
        navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artist: t ? t.author : "José Martí",
            artwork: [{ src: t ? t.cover : 'assets/icons/icon-512.png', sizes: '512x512', type: 'image/png' }]
        });
        navigator.mediaSession.setActionHandler('play', () => audio.play());
        navigator.mediaSession.setActionHandler('pause', () => audio.pause());
        navigator.mediaSession.setActionHandler('previoustrack', playPrevInList);
        navigator.mediaSession.setActionHandler('nexttrack', playNextInList);
        navigator.mediaSession.setActionHandler('seekbackward', () => skip(-30));
        navigator.mediaSession.setActionHandler('seekforward', () => skip(30));
    }

    // 2. Carga del audio en el reproductor
    audio.src = url;
    document.getElementById('track-title').innerText = title;
    document.getElementById('track-title').style.color = "var(--brand-blue)";

    currentPlayingUrl = url;
    currentPlayingItemId = queueId;

    localStorage.setItem('parlantia_last_played', url);
    if (queueId) localStorage.setItem('parlantia_last_played_id', queueId);
    else localStorage.removeItem('parlantia_last_played_id');

    // 3. Recuperar el progreso (por donde te quedaste)
    try {
        let progressKey = queueId ? queueId : url;
        audio.currentTime = trackProgress[progressKey] || 0;
    } catch (e) { }

    audio.play().catch(e => console.warn("Esperando interacción:", e));

    togglePlayIcons(true);
    // refreshActiveViews();

    document.querySelectorAll('.playlist-item').forEach(el => {
        const isCurrent = el.getAttribute('data-id') === queueId;
        
        // Mover la clase active
        el.classList.toggle('active', isCurrent);
        
        // Ajustar el peso de la fuente del título (como estaba en el render)
        const titleSpan = el.querySelector('span');
        if (titleSpan) titleSpan.style.fontWeight = isCurrent ? '700' : '500';
    });

    // 2. Actualizar solo lo necesario
    updatePlayerButtons(); 
    if (typeof syncOfflineUI === 'function') syncOfflineUI();

    // 4. EL PORTERO: ¿Hay que descargar o ya lo tenemos?
    caches.match(url).then(async (res) => {
        if (!res) {
            try { res = await caches.match(decodeURIComponent(url)); } catch (e) { }
        }

        if (!res) {
            // CAMINO ROJO: No está offline.
            if (activeDownloadToast) activeDownloadToast.remove();
            activeDownloadToast = showToast("⬇️ Iniciando descarga de fondo...", 2000);

            // FASE 4: ¡Escudos arriba! Bloqueamos la barra para proteger la descarga.
            toggleSeeker(false);

            startBackgroundDownload(url, title);
        } else {
            // CAMINO VERDE: Ya es offline.
            console.log("Reproduciendo desde caché local.");

            // FASE 4: ¡Vía libre! Desbloqueamos la barra porque no hay nada que proteger.
            toggleSeeker(true);
        }
    });
}

function togglePlayPause() {
    if (!audio.src || audio.src.endsWith(window.location.host + "/")) {
        if (currentPlayingUrl) {
            const track = myList.find(t => t.url === currentPlayingUrl) || allTracks.find(t => t.url === currentPlayingUrl);
            if (track) return playTrack(track.url, track.title);
        } else if (myList.length > 0) {
            return playTrack(myList[0].url, myList[0].title);
        } else {
            return showToast("Añade algo a tu lista primero");
        }
    }
    if (audio.paused) { audio.play(); togglePlayIcons(true); }
    else { audio.pause(); togglePlayIcons(false); }
}

function togglePlayIcons(p) { document.getElementById('icon-play').style.display = p ? 'none' : 'block'; document.getElementById('icon-pause').style.display = p ? 'block' : 'none'; }
function skip(s) { if (audio.src && !isNaN(audio.duration)) audio.currentTime += s; }
function seekAudio() { if (audio.src) audio.currentTime = (progBar.value / 100) * audio.duration; }

function playPrevInList() {
    const idx = myList.findIndex(t => t.id === currentPlayingItemId);
    if (idx > 0) playTrack(myList[idx - 1].url, myList[idx - 1].title, myList[idx - 1].id);
}

function playNextInList() {
    const idx = myList.findIndex(t => t.id === currentPlayingItemId);
    if (idx !== -1 && idx < myList.length - 1) {
        playTrack(myList[idx + 1].url, myList[idx + 1].title, myList[idx + 1].id);
    } else {
        currentPlayingUrl = null; currentPlayingItemId = null;
        togglePlayIcons(false); refreshActiveViews();
    }
}

function changeSpeed() { if (!audio.src) return; const s = [1, 1.25, 1.5, 2]; let n = (s.indexOf(audio.playbackRate) + 1) % s.length; audio.playbackRate = s[n]; document.getElementById('btn-speed').innerText = s[n] + "x"; }
function changeVolume() { if (audio) audio.volume = document.getElementById('volume-bar').value; }
function formatTime(s) { if (isNaN(s)) return "0:00"; const m = Math.floor(s / 60), sc = Math.floor(s % 60); return `${m}:${sc < 10 ? '0' : ''}${sc}`; }

// --- FUNCIONALIDAD 2.1: TEMPORIZADOR ---
function toggleTimerMenu() {
    const menu = document.getElementById('timer-menu');
    menu.style.display = (menu.style.display === 'none') ? 'block' : 'none';
}

function setSleepTimer(minutes) {
    if (sleepTimerId) { clearTimeout(sleepTimerId); sleepTimerId = null; }
    document.getElementById('timer-menu').style.display = 'none';

    if (minutes === 0) {
        showToast("Temporizador desactivado");
        document.getElementById('btn-timer').innerText = "⏲️";
        return;
    }

    showToast(`El audio se detendrá en ${minutes} minutos`);
    document.getElementById('btn-timer').innerText = `⏳${minutes}'`;

    sleepTimerId = setTimeout(() => {
        if (!audio.paused) {
            audio.pause();
            togglePlayIcons(false);
            showToast("Temporizador: Reproducción detenida");
            document.getElementById('btn-timer').innerText = "⏲️";
            sleepTimerId = null;
        }
    }, minutes * 60000);
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('timer-menu');
    const btn = document.getElementById('btn-timer');
    if (menu && menu.style.display === 'block' && e.target !== btn && !menu.contains(e.target)) {
        menu.style.display = 'none';
    }
});

async function clearAudioCache() {
    // Buscamos todas las cajas que contengan audios de Parlantia
    const cacheNames = await caches.keys();
    const audioCaches = cacheNames.filter(name => name.includes('parlantia-audio'));

    if (audioCaches.length === 0) { 
        showToast("No hay audios que limpiar"); 
        return; 
    }

    // Llamamos al modal personalizado
    showParlantiaModal(
        "¿Limpieza Inteligente?",
        "Se eliminarán los audios descargados que NO estén actualmente en tu Lista de Reproducción. ¿Deseas continuar?",
        "Sí, limpiar",
        true, // Botón rojo
        async () => {
            // El usuario confirmó, arrancamos a borrar
            const playlistUrls = myList.map(item => new URL(item.url, window.location.origin).href);
            let deletedCount = 0;

            for (const cacheName of audioCaches) {
                const cache = await caches.open(cacheName);
                const keys = await cache.keys();

                const toDelete = keys.filter(req => !playlistUrls.includes(new URL(req.url).href));
                for (const req of toDelete) {
                    await cache.delete(req);
                    deletedCount++;
                }
            }

            if (deletedCount > 0) {
                showToast(`Limpieza finalizada: ${deletedCount} archivos eliminados`);
                // Le damos 1.5 segundos para que lea el toast antes de recargar
                setTimeout(() => location.reload(), 1500);
            } else {
                showToast("Todo está en tu Lista. Nada que borrar.");
            }
        }
    );
}




// Cuenta cuántas veces aparece una URL (o un libro) en la cola
function getQueueCount(url) {
    return myList.filter(item => item.url === url).length;
}

// --- CONTROL DE SEEKER (Ahorro de Datos en Cuba) ---
function toggleSeeker(enabled) {
    const progBar = document.getElementById('progress-bar');

    // MAGIA: Seleccionamos TODOS los botones que llamen a la función "skip" (los 4 botones)
    const skipBtns = document.querySelectorAll('button[onclick^="skip"]');

    // 1. Bloqueamos la barra principal
    progBar.disabled = !enabled;
    progBar.style.pointerEvents = enabled ? "auto" : "none";
    progBar.style.opacity = enabled ? "1" : "0.5";

    // 2. Bloqueamos los 4 botones de salto en el tiempo
    skipBtns.forEach(btn => {
        btn.disabled = !enabled;
        btn.style.pointerEvents = enabled ? "auto" : "none";
        // Si se activa, borramos el estilo para que respete tu CSS original, si se desactiva lo atenuamos
        btn.style.opacity = enabled ? "" : "0.3";
    });
}

function startBackgroundDownload(url, title) {
    if (activeDownloads[url]) return;

    const controller = new AbortController();
    activeDownloads[url] = { title: title, controller: controller };

    if (document.getElementById('view-downloads').style.display === 'block') {
        renderDownloadsTab();
    }

    fetch(url, { signal: controller.signal })
        .then(response => {
            if (response.ok || response.status === 0) {
                return caches.open('parlantia-audio-v6').then(cache => cache.put(url, response));
            }
        })
        .then(() => {
            // ¡ÉXITO!
            delete activeDownloads[url];
            if (document.getElementById('view-downloads').style.display === 'block') renderDownloadsTab();
            markOfflineTracks();
            showToast(`✅ ${title} guardado offline`);

            // FASE 4: Si esta era la canción que estaba sonando, liberamos los controles
            if (url === currentPlayingUrl) toggleSeeker(true);
        })
        .catch(err => {
            // ERROR DE RED O CANCELACIÓN
            delete activeDownloads[url];
            if (document.getElementById('view-downloads').style.display === 'block') renderDownloadsTab();

            // FASE 4: Si falló la red, liberamos para que la app no se quede trabada
            if (url === currentPlayingUrl) toggleSeeker(true);
        });
}

// Fase 2.4: Función Cancelar (La que usará el botón ✕ Cancelar)
function cancelDownload(url) {
    if (activeDownloads[url]) {
        // ACTIVAMOS EL INTERRUPTOR: Esto mata la conexión de red inmediatamente
        activeDownloads[url].controller.abort();
        showToast("Descarga cancelada");
    }
}

// Función para pintar la lista en el HTML (Se conecta con tu nuevo tab)
function renderDownloadsTab() {
    const container = document.getElementById('downloads-container');
    if (!container) return;

    const urls = Object.keys(activeDownloads);

    if (urls.length === 0) {
        container.innerHTML = `<div class="empty-state"><h2 class="empty-title">No hay descargas activas en este momento</h2></div>`;
        return;
    }

    let html = '';
    urls.forEach(url => {
        const task = activeDownloads[url];

        // FASE 4 (Adelantada): El Bloqueo de Seguridad. 
        // Si es la canción actual, no dejamos cancelar.
        const isPlayingThis = (url === currentPlayingUrl);

        html += `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid #eee;">
            <div style="flex:1; min-width:0; padding-right:10px;">
                <span style="font-weight:500; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${task.title}</span>
                <span style="color: var(--brand-orange); font-size:0.8rem; font-weight:bold;">⬇️ Descargando...</span>
            </div>
            <button class="btn-small" 
                    onclick="cancelDownload('${url}')" 
                    style="color:${isPlayingThis ? '#999' : '#d32f2f'}; background:${isPlayingThis ? '#eee' : '#ffebee'}; border:1px solid ${isPlayingThis ? '#ccc' : '#d32f2f33'};"
                    ${isPlayingThis ? 'disabled' : ''}>
                ✕ Cancelar
            </button>
        </div>`;
    });

    container.innerHTML = html;
}

// --- MOTOR DEL MODAL PERSONALIZADO ---
function showParlantiaModal(title, message, confirmText, isDestructive, onConfirmCallback) {
    const overlay = document.getElementById('parlantia-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('modal-btn-confirm');

    // Llenar los datos
    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText;

    // Pintar el botón de Aceptar de Rojo (peligro) o Naranja (normal)
    if (isDestructive) {
        confirmBtn.style.background = '#d32f2f';
        confirmBtn.style.boxShadow = '0 4px 15px rgba(211, 47, 47, 0.3)';
    } else {
        confirmBtn.style.background = 'var(--brand-orange)';
        confirmBtn.style.boxShadow = '0 4px 15px rgba(251, 140, 0, 0.3)';
    }

    // Qué pasa al darle aceptar
    confirmBtn.onclick = () => {
        if (onConfirmCallback) onConfirmCallback();
        closeModal();
    };

    // Mostrar el modal
    overlay.style.display = 'flex';
}

function closeModal() {
    document.getElementById('parlantia-modal').style.display = 'none';
}

// --- NUEVA FUNCIÓN: Inyector de Audios desde el Catálogo ---
function playFromCatalog(url, title) {
    // 1. Creamos un ID único para esta instancia en la cola
    const newId = generateQueueId();

    // 2. Añadimos la pista exactamente al final de Mi Lista
    myList.push({ id: newId, title: title, url: url });
    
    // 3. Guardamos en la memoria del teléfono para no perderlo
    localStorage.setItem('parlantia_playlist', JSON.stringify(myList));

    // 4. Llamamos a tu reproductor oficial. 
    // Al pasarle el nuevo ID, ya no es un "fantasma".
    // Nota: playTrack automáticamente pausa lo que estaba sonando al cambiar el src.
    playTrack(url, title, newId);

    // 5. Refrescamos la vista para que el usuario vea el cambio si está en ese Tab
    showToast("Reproduciendo y añadido a tu lista");
    refreshActiveViews();
}

document.addEventListener('DOMContentLoaded', () => {
    loadCatalog();
    initPlayerEvents();
    restorePlayerState();
    showTab('playlist');
    syncOfflineUI(); // <- AÑADIR AQUÍ
});

// ==========================================
// CEREBRO OFFLINE-FIRST (INDICADOR Y BLOQUEO VISUAL)
// ==========================================
async function syncOfflineUI() {
    const isOffline = !navigator.onLine;
    
    // 1. Actualizar Indicador Visual
    const dot = document.getElementById('network-dot');
    const text = document.getElementById('network-text');
    if (dot) dot.style.background = isOffline ? '#d32f2f' : '#4CAF50';
    if (text) text.innerText = isOffline ? 'Offline' : 'Online';

    // 2. Escanear y Bloquear Botones
    const buttons = document.querySelectorAll('.play-btn-smart');
    if (!buttons.length) return;

    try {
        const cache = await caches.open('parlantia-audio-v6');
        const keys = await cache.keys();
        const cachedUrls = keys.map(k => {
            try { return decodeURIComponent(k.url); } catch(e) { return k.url; }
        });

        buttons.forEach(btn => {
            const url = btn.getAttribute('data-url');
            if (!isOffline) {
                btn.disabled = false;
                btn.style.opacity = "1";
                btn.style.cursor = "pointer";
            } else {
                let fName = url.split('/').pop().split('?')[0];
                try { fName = decodeURIComponent(url).split('/').pop().split('?')[0]; } catch(e){}
                
                const isCached = cachedUrls.some(c => c.includes(fName));
                btn.disabled = !isCached;
                btn.style.opacity = isCached ? "1" : "0.3";
                btn.style.cursor = isCached ? "pointer" : "not-allowed";
            }
        });
    } catch (e) { console.warn("Error en sincronización offline", e); }
}

// Escuchas globales de red
window.addEventListener('online', syncOfflineUI);
window.addEventListener('offline', syncOfflineUI);

if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('sw.js')); }

