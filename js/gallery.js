const viewer = document.querySelector('[data-gallery-viewer]');
const photos = [...document.querySelectorAll('[data-gallery-photo]')];
if (viewer && photos.length && typeof viewer.showModal === 'function') {
    const image = viewer.querySelector('[data-gallery-image]');
    const status = viewer.querySelector('[data-gallery-status]');
    const title = viewer.querySelector('[data-gallery-title]');
    const caption = viewer.querySelector('[data-gallery-caption]');
    const count = viewer.querySelector('[data-gallery-count]');
    const info = viewer.querySelector('[data-gallery-info]');
    const previous = viewer.querySelector('[data-gallery-prev]');
    const next = viewer.querySelector('[data-gallery-next]');
    let current = 0;
    let opener = null;
    let previousOverflow = '';
    const show = (index) => {
        current = (index + photos.length) % photos.length;
        const photo = photos[current];
        status.textContent = 'Loading photograph…';
        status.hidden = false;
        image.style.opacity = '0';
        image.alt = photo.dataset.alt;
        image.src = photo.href;
        title.textContent = photo.dataset.title;
        caption.textContent = photo.dataset.caption;
        count.textContent = `${current + 1} / ${photos.length}`;
        info.replaceChildren();
        let fields = [];
        try { fields = JSON.parse(photo.dataset.info || '[]'); } catch { /* Keep the image usable if metadata is invalid. */ }
        fields.forEach(field => {
            const row = document.createElement('div');
            const label = document.createElement('dt');
            const value = document.createElement('dd');
            label.textContent = field.label;
            value.textContent = field.value;
            if (field.source) {
                const source = document.createElement('small');
                source.textContent = field.source;
                value.appendChild(source);
            }
            row.append(label, value);
            info.appendChild(row);
        });
        previous.hidden = next.hidden = photos.length < 2;
    };
    image.addEventListener('load', () => { status.hidden = true; image.style.opacity = '1'; });
    image.addEventListener('error', () => { status.textContent = 'This photograph could not be loaded.'; });
    photos.forEach((photo, index) => photo.addEventListener('click', event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        opener = photo;
        show(index);
        previousOverflow = document.documentElement.style.overflow;
        viewer.showModal();
        document.documentElement.style.overflow = 'hidden';
    }));
    const restorePage = () => {
        if (viewer.open) return;
        document.documentElement.style.overflow = previousOverflow;
        image.removeAttribute('src');
        opener?.focus();
    };
    const close = () => { viewer.close(); restorePage(); };
    viewer.querySelector('[data-gallery-close]').addEventListener('click', close);
    viewer.addEventListener('cancel', event => { event.preventDefault(); close(); });
    previous.addEventListener('click', () => show(current - 1));
    next.addEventListener('click', () => show(current + 1));
    viewer.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            show(current + (event.key === 'ArrowLeft' ? -1 : 1));
        }
    });
    viewer.addEventListener('click', event => { if (event.target === viewer) close(); });
    viewer.addEventListener('close', restorePage);
}
