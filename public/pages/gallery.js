import { $, esc, api, initSite, isAdmin, hydrateIcons, wireDialog, fmtLongDay } from '../site.js';
import { icon } from '../config.js';

await initSite('gallery');

let photos = [];
try {
  photos = await api('/gallery');
} catch {
  $('#albums').innerHTML = '<div class="empty-card"><p>Couldn’t load photos right now. Try refreshing.</p></div>';
}

// Group photos into albums: one per event, plus "More moments" for photos not tied to an event.
const albums = new Map();
for (const p of photos) {
  const key = p.event?.id || '_other';
  if (!albums.has(key)) albums.set(key, { event: p.event, photos: [] });
  albums.get(key).photos.push(p);
}
// Event albums first (newest event first), loose photos at the end.
if (albums.has('_other')) {
  const other = albums.get('_other');
  albums.delete('_other');
  albums.set('_other', other);
}
const flat = [...albums.values()].flatMap((a) => a.photos); // lightbox order matches page order

if (!photos.length && !$('#albums').innerHTML) {
  $('#albums').innerHTML = `<div class="empty-card">${icon('image')}<strong>No photos yet</strong>
    <p>Photos from our events will show up here.</p>
    ${isAdmin() ? '<a class="btn btn-primary btn-small" href="/admin?tab=gallery">Add photos</a>' : ''}</div>`;
} else if (photos.length) {
  $('#albums').innerHTML = [...albums.entries()].map(([key, a]) => `
    <section class="album" id="${a.event ? `event-${esc(a.event.id)}` : 'more'}">
      <div class="album-head">
        <h2>${a.event ? `<a href="/events?event=${esc(a.event.id)}">${esc(a.event.title)}</a>` : 'More moments'}</h2>
        <span>${a.event ? `${esc(fmtLongDay(a.event.startsAt))} · ` : ''}${a.photos.length} photo${a.photos.length === 1 ? '' : 's'}</span>
      </div>
      <div class="photo-masonry">${a.photos.map((p) => `
        <figure data-i="${flat.indexOf(p)}"><img src="${esc(p.url)}" alt="${esc(p.caption || (a.event ? a.event.title : 'Event photo'))}" loading="lazy" />
          ${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}</figure>`).join('')}</div>
    </section>`).join('');
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}

// ---------- lightbox ----------
const lb = $('#lightbox');
wireDialog(lb);
let current = 0;
function show(i) {
  current = (i + flat.length) % flat.length;
  const p = flat[current];
  $('#lbImg').src = p.url;
  $('#lbImg').alt = p.caption || '';
  $('#lbCaption').textContent = [p.caption, p.event?.title].filter(Boolean).join(' — ');
  $('#lbPrev').hidden = $('#lbNext').hidden = flat.length < 2;
}
$('#albums').addEventListener('click', (e) => {
  const fig = e.target.closest('figure[data-i]');
  if (!fig) return;
  show(Number(fig.dataset.i));
  lb.showModal();
});
$('#lbPrev').onclick = () => show(current - 1);
$('#lbNext').onclick = () => show(current + 1);
lb.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') show(current - 1);
  if (e.key === 'ArrowRight') show(current + 1);
});
hydrateIcons();
