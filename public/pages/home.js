import { $, esc, api, initSite, getSite, eventCard, hydrateIcons } from '../site.js';
import { CATEGORIES } from '../config.js';
import { REGION } from '../region.js';
import { mapStyle } from '../map-style.js';

await initSite('home');

// Hero text comes from the club's editable site info.
getSite().then(({ site, stats }) => {
  $('#heroTitle').textContent = site.heroTitle;
  $('#heroText').textContent = site.heroText;
  if (stats.spaces) $('#spaceCount').textContent = `${stats.spaces} places to rest, read and meet — add yours`;
});

// Next three events.
try {
  const all = await api('/events');
  const upcoming = all.filter((e) => !e.past).slice(0, 3);
  // Nothing scheduled? Show the latest pop-ups instead of an empty box.
  const recent = all.filter((e) => e.past).reverse().slice(0, 3);
  if (!upcoming.length && recent.length) $('#upcomingTitle').textContent = 'Recent pop-ups';
  const list = upcoming.length ? upcoming : recent;
  $('#upcoming').innerHTML = list.length
    ? `<div class="event-grid">${list.map((e) => eventCard(e)).join('')}</div>`
    : `<div class="empty-card"><span class="icon" data-icon="calendar"></span><strong>No events on the calendar yet</strong><p>Check back soon, or follow along on Instagram.</p></div>`;
} catch {
  $('#upcoming').innerHTML = '<div class="empty-card"><p>Couldn’t load events right now.</p></div>';
}
hydrateIcons($('#upcoming'));

// A few recent photos.
try {
  const photos = (await api('/gallery')).slice(0, 4);
  if (photos.length) {
    $('#photoStrip').innerHTML = photos.map((p) => `<a href="/gallery"><img src="${esc(p.url)}" alt="${esc(p.caption || p.event?.title || 'Event photo')}" loading="lazy" /></a>`).join('');
    $('#photosSection').hidden = false;
  }
} catch { /* section stays hidden */ }

// Small, non-interactive preview of the third spaces map.
const mini = new maplibregl.Map({
  container: 'miniMap',
  style: mapStyle,
  center: REGION.center,
  zoom: REGION.zoom - 0.6,
  interactive: false,
  attributionControl: false,
});
mini.on('load', async () => {
  let spaces = [];
  try { spaces = await api('/spaces'); } catch { return; }
  mini.addSource('spaces', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: spaces.map((s) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lng, s.lat] }, properties: { color: CATEGORIES[s.category]?.color || '#7a746b' } })) },
  });
  mini.addLayer({
    id: 'spaces', type: 'circle', source: 'spaces',
    paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
  });
});
