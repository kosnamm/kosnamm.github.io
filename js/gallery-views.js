const root = document.querySelector('[data-gallery-views]');

if (root) {
    const links = [...root.querySelectorAll('[data-gallery-view-link]')];
    const panels = [...root.querySelectorAll('[data-gallery-view-panel]')];
    const views = new Set(panels.map(panel => panel.dataset.galleryViewPanel));
    const mapElement = root.querySelector('[data-gallery-map]');
    const mapStatus = root.querySelector('[data-gallery-map-status]');
    const placeButtons = [...root.querySelectorAll('[data-map-place]')];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let catalog = [];
    try {
        const value = JSON.parse(root.querySelector('[data-gallery-catalog]')?.textContent || '[]');
        if (Array.isArray(value)) catalog = value;
    } catch { /* The server-rendered photographs remain available. */ }

    const groups = new Map();
    catalog.forEach(photo => {
        const latitude = photo.map?.latitude;
        const longitude = photo.map?.longitude;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
        const key = photo.mapKey || `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
        if (!groups.has(key)) groups.set(key, { key, latitude, longitude, photos: [] });
        groups.get(key).photos.push(photo);
    });

    let map = null;
    let mapPromise = null;
    let leafletPromise = null;
    const markers = new Map();
    const mappedCount = [...groups.values()].reduce((count, group) => count + group.photos.length, 0);
    const approximate = [...groups.values()].some(group => group.photos.some(photo => photo.map.precision !== 'exact'));
    const summary = `${mappedCount} ${mappedCount === 1 ? 'photograph' : 'photographs'} · ${groups.size} ${groups.size === 1 ? 'place' : 'places'}${approximate ? ' · Approximate areas' : ''}`;

    const setStatus = message => { if (mapStatus) mapStatus.textContent = message; };
    const selectedPlace = key => {
        placeButtons.forEach(button => {
            const selected = button.dataset.mapPlace === key;
            button.classList.toggle('is-active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
    };
    const loadLeaflet = () => leafletPromise ||= Promise.all([
        new Promise((resolve, reject) => {
            const stylesheet = document.createElement('link');
            stylesheet.rel = 'stylesheet';
            stylesheet.href = new URL('../vendor/leaflet/leaflet.css', import.meta.url).href;
            stylesheet.addEventListener('load', resolve, { once: true });
            stylesheet.addEventListener('error', reject, { once: true });
            document.head.appendChild(stylesheet);
        }),
        new Promise((resolve, reject) => {
            if (window.L) return resolve();
            const script = document.createElement('script');
            script.src = new URL('../vendor/leaflet/leaflet.js', import.meta.url).href;
            script.addEventListener('load', () => window.L ? resolve() : reject(), { once: true });
            script.addEventListener('error', reject, { once: true });
            document.head.appendChild(script);
        }),
    ]);
    const popupFor = group => {
        const popup = document.createElement('div');
        popup.className = 'gallery-map-popup';
        const heading = document.createElement('strong');
        heading.textContent = group.photos[0].location || 'Photographs';
        popup.appendChild(heading);
        if (group.photos.some(photo => photo.map.precision !== 'exact')) {
            const precision = document.createElement('p');
            precision.className = 'gallery-map-popup__precision';
            precision.textContent = 'Approximate area';
            popup.appendChild(precision);
        }
        const photographs = document.createElement('div');
        photographs.className = 'gallery-map-popup__photos';
        group.photos.forEach(photo => {
            const link = document.createElement('a');
            link.href = photo.imageURL;
            link.className = 'gallery-map-popup__photo';
            const image = document.createElement('img');
            image.src = photo.thumbnailURL;
            image.alt = photo.alt || photo.title || photo.albumTitle;
            image.loading = 'lazy';
            const label = document.createElement('span');
            label.textContent = photo.title || photo.albumTitle;
            link.append(image, label);
            link.addEventListener('click', event => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                const viewer = document.querySelector('[data-gallery-viewer]');
                if (!viewer || typeof viewer.showModal !== 'function') return;
                const open = new CustomEvent('gallery:open', { bubbles: true, cancelable: true, detail: { photoId: photo.id, opener: link } });
                if (!link.dispatchEvent(open)) event.preventDefault();
            });
            photographs.appendChild(link);
        });
        popup.appendChild(photographs);
        return popup;
    };

    const initializeMap = () => {
        if (!mapElement || !groups.size) {
            if (mapElement) mapElement.hidden = true;
            setStatus('No locations to show yet. Photographs are listed below.');
            return Promise.resolve();
        }
        if (map) {
            requestAnimationFrame(() => map.invalidateSize({ pan: false }));
            return Promise.resolve();
        }
        if (mapPromise) return mapPromise;
        setStatus('Loading map…');
        mapElement.setAttribute('aria-busy', 'true');
        mapPromise = loadLeaflet().then(() => {
            if (root.dataset.galleryActiveView !== 'map') {
                mapPromise = null;
                mapElement.setAttribute('aria-busy', 'false');
                return;
            }
            const L = window.L;
            map = L.map(mapElement, { scrollWheelZoom: false, preferCanvas: true });
            let tileError = false;
            const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                minZoom: 1,
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            });
            tiles.on('tileerror', () => {
                tileError = true;
                setStatus(`${summary}. Some map tiles could not load; photographs remain available below.`);
                mapElement.setAttribute('aria-busy', 'false');
            });
            tiles.on('load', () => {
                if (!tileError) setStatus(summary);
                mapElement.setAttribute('aria-busy', 'false');
            });
            tiles.addTo(map);
            const bounds = [];
            groups.forEach(group => {
                const badge = document.createElement('span');
                badge.textContent = String(group.photos.length);
                const approximateArea = group.photos.some(photo => photo.map.precision !== 'exact');
                const label = `${group.photos[0].location || 'Location'} · ${group.photos.length} ${group.photos.length === 1 ? 'photograph' : 'photographs'}${approximateArea ? ' · Approximate area' : ''}`;
                const marker = L.marker([group.latitude, group.longitude], {
                    icon: L.divIcon({ className: 'gallery-map-marker', html: badge, iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -22] }),
                    title: label,
                    alt: label,
                    keyboard: true,
                }).addTo(map).bindPopup(popupFor(group), { minWidth: 220, maxWidth: 320 });
                marker.on('popupopen', () => selectedPlace(group.key));
                markers.set(group.key, marker);
                marker.getElement()?.setAttribute('aria-label', label);
                bounds.push([group.latitude, group.longitude]);
            });
            if (bounds.length === 1) map.setView(bounds[0], approximate ? 5 : 10);
            else map.fitBounds(bounds, { padding: [48, 48], maxZoom: approximate ? 7 : 12, animate: false });
            requestAnimationFrame(() => map.invalidateSize({ pan: false }));
            setStatus(summary);
        }).catch(() => {
            mapElement.hidden = true;
            mapElement.setAttribute('aria-busy', 'false');
            setStatus('The map could not be loaded. Browse photographs by place below.');
        });
        return mapPromise;
    };

    placeButtons.forEach(button => {
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', async () => {
            await initializeMap();
            const key = button.dataset.mapPlace;
            const group = groups.get(key);
            const marker = markers.get(key);
            if (map && marker && group) {
                map.setView(marker.getLatLng(), group.photos.some(photo => photo.map.precision !== 'exact') ? 5 : 10, { animate: !reducedMotion.matches });
                marker.openPopup();
                mapElement.scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
                marker.getElement()?.focus({ preventScroll: true });
            } else {
                [...root.querySelectorAll('[data-map-photo-group]')].find(element => element.dataset.mapPhotoGroup === key)?.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
            }
            selectedPlace(key);
        });
    });

    const readView = () => {
        const url = new URL(window.location.href);
        const requested = url.searchParams.get('view') || url.hash.replace('#gallery-view-', '');
        return views.has(requested) ? requested : 'albums';
    };
    const activate = (view, updateHistory = false) => {
        if (!views.has(view)) view = 'albums';
        root.dataset.galleryActiveView = view;
        links.forEach(link => {
            const selected = link.dataset.galleryViewLink === view;
            link.setAttribute('aria-selected', String(selected));
            link.tabIndex = selected ? 0 : -1;
        });
        panels.forEach(panel => { panel.hidden = panel.dataset.galleryViewPanel !== view; });
        if (updateHistory) {
            const url = new URL(window.location.href);
            if (view === 'albums') url.searchParams.delete('view');
            else url.searchParams.set('view', view);
            url.hash = `gallery-view-${view}`;
            window.history.pushState(null, '', url);
        }
        if (view === 'map') initializeMap();
    };

    const tablist = links[0]?.closest('nav') || links[0]?.parentElement;
    if (tablist && links.length && views.has('albums')) {
        tablist.setAttribute('role', 'tablist');
        tablist.setAttribute('aria-label', 'Gallery views');
        links.forEach((link, index) => {
            const view = link.dataset.galleryViewLink;
            link.id = `gallery-tab-${view}`;
            link.setAttribute('role', 'tab');
            link.setAttribute('aria-controls', `gallery-view-${view}`);
            link.addEventListener('click', event => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                activate(view, true);
            });
            link.addEventListener('keydown', event => {
                let next = index;
                if (event.key === 'ArrowRight') next = (index + 1) % links.length;
                else if (event.key === 'ArrowLeft') next = (index - 1 + links.length) % links.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = links.length - 1;
                else return;
                event.preventDefault();
                links[next].focus();
                activate(links[next].dataset.galleryViewLink, true);
            });
        });
        panels.forEach(panel => {
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby', `gallery-tab-${panel.dataset.galleryViewPanel}`);
            panel.tabIndex = 0;
        });
        window.addEventListener('popstate', () => activate(readView()));
        activate(readView());
    }
}
