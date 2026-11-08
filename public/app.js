import { ICONS, icon, CATEGORIES, AMENITIES, DAYS, DAY_NAMES, NOISE, COST, BUSY } from './config.js';
import { REGION, REGION_BBOX, inRegion } from './region.js';
import { mapStyle } from './map-style.js';

import {
  $, $$, esc, debounce, store, api, toast, relTime, initSite, onUserChange, openAuth, requireAuth,
  addMenuItem, refreshAdminCount,
} from './site.js';

// ---------- helpers ----------
const isMobile = () => matchMedia('(max-width: 820px)').matches;

function milesBetween([lng1, lat1], [lng2, lat2]) {
  const R = 3958.8, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const fmtMiles = (mi) => (mi < 0.1 ? `${Math.round(mi * 5280 / 10) * 10} ft` : `${mi.toFixed(mi < 10 ? 1 : 0)} mi`);

const stars = (r) => {
  const full = Math.round(r);
  return `<span class="stars">${'★'.repeat(full)}<span class="off">${'★'.repeat(5 - full)}</span></span>`;
};

// ---------- hours ----------
// Hours are stored per day as "HH:MM-HH:MM", "24h", "closed" or "" (unknown). Times are Philadelphia time.
function phillyNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { day: parts.weekday.toLowerCase().slice(0, 3), mins: Number(parts.hour) * 60 + Number(parts.minute) };
}

function parseRange(h) {
  if (!h) return null;
  if (h === 'closed') return 'closed';
  if (h === '24h') return { open: 0, close: 1440 };
  const [a, b] = h.split('-').map((t) => { const [hh, mm] = t.split(':').map(Number); return hh * 60 + mm; });
  return { open: a, close: b <= a ? b + 1440 : b };
}

function fmtTime(m) {
  m = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  if (m === 0) return 'midnight';
  if (m === 720) return 'noon';
  return `${h % 12 || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

function fmtRange(h) {
  const r = parseRange(h);
  if (!r) return '—';
  if (r === 'closed') return 'Closed';
  if (r.open === 0 && r.close === 1440) return 'Open 24 hours';
  return `${fmtTime(r.open)} – ${fmtTime(r.close)}`;
}

function openStatus(space) {
  const hours = space.hours || {};
  if (!DAYS.some((d) => hours[d])) return { state: 'unknown', text: 'Hours not listed' };
  const { day, mins } = phillyNow();
  const idx = DAYS.indexOf(day);
  const today = parseRange(hours[day]);
  const yest = parseRange(hours[DAYS[(idx + 6) % 7]]);

  if (yest && yest !== 'closed' && yest.close > 1440 && mins < yest.close - 1440) {
    return { state: 'open', text: 'Open', detail: `closes ${fmtTime(yest.close)}` };
  }
  if (today && today !== 'closed') {
    if (today.open === 0 && today.close === 1440) return { state: 'open', text: 'Open 24 hours' };
    if (mins >= today.open && mins < today.close) return { state: 'open', text: 'Open', detail: `closes ${fmtTime(today.close)}` };
    if (mins < today.open) return { state: 'closed', text: 'Closed', detail: `opens ${fmtTime(today.open)}` };
  }
  if (today === null) return { state: 'unknown', text: 'Hours vary today' };
  for (let i = 1; i <= 7; i++) {
    const d = DAYS[(idx + i) % 7];
    const r = parseRange(hours[d]);
    if (r && r !== 'closed') {
      const when = i === 1 ? 'tomorrow' : DAY_NAMES[d].slice(0, 3);
      return { state: 'closed', text: 'Closed', detail: `opens ${when} ${fmtTime(r.open)}` };
    }
  }
  return { state: 'closed', text: 'Closed' };
}

// Open until 10 PM or later today (or overnight).
function openLateToday(space) {
  const r = parseRange(space.hours?.[phillyNow().day]);
  return Boolean(r && r !== 'closed' && r.close >= 22 * 60);
}

// Distance shown on cards: from you if we know where you are, otherwise from campus.
const refPoint = () => state.userLoc || REGION.campus.coords;
function distLabel(s) {
  const d = fmtMiles(milesBetween(refPoint(), [s.lng, s.lat]));
  return state.userLoc ? d : `${d} from ${REGION.campus.name}`;
}

const statusHtml = (s) => {
  const st = openStatus(s);
  return `<span class="status ${st.state}">${esc(st.text)}</span>${st.detail ? ` <span>· ${esc(st.detail)}</span>` : ''}`;
};

// ---------- state ----------
const state = {
  spaces: [],
  q: '',
  cats: new Set(),
  amen: new Set(),
  openNow: false,
  savedOnly: false,
  inView: false,
  noise: '',
  cost: '',
  sort: 'recommended',
  selectedId: null,
  hoverId: null,
  userLoc: null,
  saved: new Set(store.get('saved', [])),
  user: null,
  mineOnly: false,
  hood: '',
  openLate: false,
};
const isAdmin = () => state.user?.role === 'admin';

const byId = (id) => state.spaces.find((s) => s.id === id);

function toggleSaved(id) {
  if (state.saved.has(id)) state.saved.delete(id);
  else state.saved.add(id);
  store.set('saved', [...state.saved]);
  toast(state.saved.has(id) ? 'Saved to your list' : 'Removed from saved');
  renderList();
  if (state.selectedId === id) renderDetail();
}

function matchesFilters(s, { ignoreView = false } = {}) {
  if (state.cats.size && !state.cats.has(s.category)) return false;
  for (const a of state.amen) if (!s.amenities.includes(a)) return false;
  if (state.noise && s.noise !== state.noise) return false;
  if (state.cost !== '' && s.cost > Number(state.cost)) return false;
  if (state.savedOnly && !state.saved.has(s.id)) return false;
  if (state.mineOnly && !s.mine) return false;
  if (state.hood && s.neighborhood !== state.hood) return false;
  if (state.openLate && !openLateToday(s)) return false;
  if (state.openNow && openStatus(s).state !== 'open') return false;
  if (state.q) {
    const hay = [s.name, s.neighborhood, s.address, s.description, CATEGORIES[s.category]?.label, ...(s.tags || [])].join(' ').toLowerCase();
    if (!state.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (!ignoreView && state.inView && mapReady && !map.getBounds().contains([s.lng, s.lat])) return false;
  return true;
}

function score(s) {
  const prior = 3.8, weight = 3;
  const bayes = ((s.rating ?? prior) * s.reviewCount + prior * weight) / (s.reviewCount + weight);
  return bayes + (s.photos.length ? 0.15 : 0) + (s.description ? 0.05 : 0);
}

function visibleSpaces() {
  const list = state.spaces.filter((s) => matchesFilters(s));
  const dist = (s) => milesBetween(refPoint(), [s.lng, s.lat]);
  const sorters = {
    recommended: (a, b) => score(b) - score(a),
    distance: (a, b) => dist(a) - dist(b),
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.reviewCount - a.reviewCount,
    newest: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return list.sort(sorters[state.sort] || sorters.recommended);
}

// ---------- shared bits ----------
function thumbHtml(s, cls = 'card-thumb') {
  const cat = CATEGORIES[s.category] || CATEGORIES.other;
  if (s.photos[0]) return `<div class="${cls}"><img src="${esc(s.photos[0])}" alt="" loading="lazy" /></div>`;
  return `<div class="${cls}" style="${placeholderBg(cat.color)}">${icon(s.category)}</div>`;
}
const placeholderBg = (color) =>
  `background-color:${color};background-image:radial-gradient(rgba(255,255,255,.16) 1.2px, transparent 1.2px);background-size:12px 12px;`;

function ratingHtml(s) {
  if (!s.reviewCount) return '<span class="rating"><small>No reviews yet</small></span>';
  return `<span class="rating"><span class="star">★</span>${s.rating.toFixed(1)} <small>(${s.reviewCount})</small></span>`;
}

function busyHtml(s) {
  if (!s.busyNow) return '';
  return `<span class="busy-pill busy-${s.busyNow.level}"><i></i>${BUSY[s.busyNow.level].short}</span>`;
}

// ---------- list ----------
function renderList() {
  const items = visibleSpaces();
  const list = $('#spaceList');
  const where = state.mineOnly ? ' added by you' : state.hood ? ` in ${esc(state.hood)}` : state.inView ? ' in this area' : ` in ${REGION.shortName}`;
  $('#resultCount').innerHTML = `${items.length} ${items.length === 1 ? 'space' : 'spaces'}${where}${state.mineOnly ? ' · <button class="link-btn" id="clearMine">Show all</button>' : ''}`;
  $('#emptyState').hidden = items.length > 0;

  list.innerHTML = items
    .map((s) => {
      const cat = CATEGORIES[s.category] || CATEGORIES.other;
      const dist = `<span class="sep">·</span><span class="campus-dist">${distLabel(s)}</span>`;
      const amen = s.amenities.slice(0, 5).map((a) => `<span title="${esc(AMENITIES[a])}">${icon(a)}</span>`).join('');
      const saved = state.saved.has(s.id);
      return `<li class="card${s.id === state.hoverId ? ' hovered' : ''}" data-id="${s.id}" tabindex="0">
        ${thumbHtml(s)}
        <div class="card-body">
          <div class="card-title">${esc(s.name)}</div>
          ${s.status === 'pending' ? '<div><span class="pill-pending">Waiting for review</span></div>' : ''}
          <div class="card-sub">${esc(cat.label)}${s.neighborhood ? ' · ' + esc(s.neighborhood) : ''}</div>
          <div class="card-meta">${ratingHtml(s)}${dist}</div>
          <div class="card-meta">${statusHtml(s)}${s.busyNow ? '<span class="sep">·</span>' + busyHtml(s) : ''}</div>
          ${amen ? `<div class="card-amen">${amen}</div>` : ''}
        </div>
        <button class="save-btn${saved ? ' saved' : ''}" data-save="${s.id}" aria-label="${saved ? 'Unsave' : 'Save'}">${icon('heart')}</button>
      </li>`;
    })
    .join('');
  updateMapData();
}

$('#resultCount').addEventListener('click', (e) => {
  if (e.target.id === 'clearMine') { state.mineOnly = false; renderList(); }
});
$('#spaceList').addEventListener('click', (e) => {
  const save = e.target.closest('[data-save]');
  if (save) return toggleSaved(save.dataset.save);
  const card = e.target.closest('.card');
  if (card) select(card.dataset.id, { fly: true });
});
$('#spaceList').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('card')) select(e.target.dataset.id, { fly: true });
});
$('#spaceList').addEventListener('mouseover', (e) => {
  const card = e.target.closest('.card');
  setHover(card ? card.dataset.id : null);
});
$('#spaceList').addEventListener('mouseleave', () => setHover(null));

// ---------- filters UI ----------
function buildFilters() {
  $('#categoryChips').innerHTML = Object.entries(CATEGORIES)
    .filter(([k]) => k !== 'other')
    .map(([k, c]) => `<button class="chip" data-cat="${k}" aria-pressed="false"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}</button>`)
    .join('');
  $('#amenityChips').innerHTML = Object.entries(AMENITIES)
    .map(([k, label]) => `<button class="chip" data-amen="${k}" aria-pressed="false">${icon(k)}${esc(label)}</button>`)
    .join('');
  setSegmented($('#noiseFilter'), '');
  setSegmented($('#costFilter'), '');
}

function setSegmented(el, value) {
  $$('button', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === String(value))));
}

function syncFilterUI() {
  $$('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(state.cats.has(b.dataset.cat))));
  $$('[data-amen]', $('#amenityChips')).forEach((b) => b.setAttribute('aria-pressed', String(state.amen.has(b.dataset.amen))));
  setSegmented($('#noiseFilter'), state.noise);
  setSegmented($('#costFilter'), state.cost);
  $('#openNow').checked = state.openNow;
  $('#openLate').checked = state.openLate;
  $('#hoodFilter').value = state.hood;
  $('#savedOnly').checked = state.savedOnly;
  $('#inView').checked = state.inView;
  $('#sortBy').value = state.sort;
  $('#search').value = state.q;
  const n = state.amen.size + (state.noise ? 1 : 0) + (state.cost !== '' ? 1 : 0) + (state.inView ? 1 : 0) + (state.hood ? 1 : 0) + (state.openLate ? 1 : 0);
  $('#filterCount').hidden = !n;
  $('#filterCount').textContent = n;
}

function onFilterChange() {
  syncFilterUI();
  renderList();
}

$('#categoryChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  const k = b.dataset.cat;
  state.cats.has(k) ? state.cats.delete(k) : state.cats.add(k);
  onFilterChange();
});
$('#amenityChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-amen]');
  if (!b) return;
  const k = b.dataset.amen;
  state.amen.has(k) ? state.amen.delete(k) : state.amen.add(k);
  onFilterChange();
});
$('#noiseFilter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.noise = b.dataset.value; onFilterChange(); } });
$('#costFilter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.cost = b.dataset.value; onFilterChange(); } });
$('#openNow').addEventListener('change', (e) => { state.openNow = e.target.checked; onFilterChange(); });
$('#savedOnly').addEventListener('change', (e) => { state.savedOnly = e.target.checked; onFilterChange(); });
$('#inView').addEventListener('change', (e) => { state.inView = e.target.checked; onFilterChange(); });
$('#openLate').addEventListener('change', (e) => { state.openLate = e.target.checked; onFilterChange(); });
$('#hoodFilter').addEventListener('change', (e) => {
  state.hood = e.target.value;
  onFilterChange();
  const inHood = state.spaces.filter((s) => s.neighborhood === state.hood);
  if (inHood.length && mapReady) {
    const b = new maplibregl.LngLatBounds();
    inHood.forEach((s) => b.extend([s.lng, s.lat]));
    map.fitBounds(b, { padding: 80, maxZoom: 15.5 });
  }
});

// Neighborhood choices come from the spaces themselves.
function buildHoodOptions() {
  const hoods = [...new Set(state.spaces.map((s) => s.neighborhood).filter(Boolean))].sort();
  if (state.hood && !hoods.includes(state.hood)) hoods.push(state.hood);
  $('#hoodFilter').innerHTML = `<option value="">All of ${REGION.shortName}</option>` + hoods.map((h) => `<option>${esc(h)}</option>`).join('');
  $('#hoodFilter').value = state.hood;
}
$('#sortBy').addEventListener('change', (e) => {
  state.sort = e.target.value;
  if (state.sort === 'distance' && !state.userLoc) toast(`Sorting by distance from ${REGION.campus.name} — tap “Near me” to use your location`);
  onFilterChange();
});
$('#search').addEventListener('input', debounce((e) => {
  state.q = e.target.value.trim();
  if (state.selectedId && state.q) closeDetail();
  if (isMobile() && state.q && layout.dataset.mobileView === 'map') setMobileView('list');
  renderList();
}, 150));
$('#filtersToggle').addEventListener('click', () => {
  const panel = $('#filterPanel');
  panel.hidden = !panel.hidden;
  $('#filtersToggle').setAttribute('aria-expanded', String(!panel.hidden));
});
function clearFilters() {
  Object.assign(state, { q: '', openNow: false, savedOnly: false, inView: false, noise: '', cost: '', mineOnly: false, hood: '', openLate: false });
  state.cats.clear();
  state.amen.clear();
  onFilterChange();
}
$('#clearFilters').addEventListener('click', clearFilters);
$('#emptyClear').addEventListener('click', clearFilters);

// ---------- mobile view switching ----------
const layout = $('#layout');
let prevMobileView = 'map';
function setMobileView(view) {
  layout.dataset.mobileView = view;
  const btn = $('#mobileToggle');
  btn.innerHTML = view === 'list' ? `${icon('map')}<span>Map</span>` : `${icon('list')}<span>List</span>`;
  if (view !== 'detail') prevMobileView = view;
  if (view === 'map' && mapReady) setTimeout(() => map.resize(), 260);
}
$('#mobileToggle').addEventListener('click', () => setMobileView(layout.dataset.mobileView === 'list' ? 'map' : 'list'));

// ---------- map ----------
const map = new maplibregl.Map({
  container: 'map',
  style: mapStyle,
  center: REGION.center,
  zoom: REGION.zoom,
  minZoom: 11,
  maxBounds: REGION.maxBounds,
  attributionControl: { compact: true },
  dragRotate: false,
  pitchWithRotate: false,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
let mapReady = false;
const mapCenter = () => { const c = map.getCenter(); return [c.lng, c.lat]; };

// Draw round category pins on a canvas and register them as map images.
function addPinImages(target) {
  const ratio = 3, size = 40;
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.shadowColor = 'rgba(35,33,29,.28)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 1.5;
    ctx.beginPath(); ctx.arc(20, 19, 14.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.beginPath(); ctx.arc(20, 19, 12.5, 0, Math.PI * 2); ctx.fillStyle = cat.color; ctx.fill();
    ctx.save();
    const s = 13 / 24;
    ctx.translate(20 - 6.5, 19 - 6.5);
    ctx.scale(s, s);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(ICONS[key]));
    ctx.restore();
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (!target.hasImage('pin-' + key)) target.addImage('pin-' + key, { width: canvas.width, height: canvas.height, data: data.data }, { pixelRatio: ratio });
  }
}

const toFeature = (s, extra = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
  properties: { id: s.id, name: s.name, category: s.category, rank: score(s), ...extra },
});

map.on('load', () => {
  addPinImages(map);
  map.addSource('spaces', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 36, clusterMaxZoom: 12 });
  map.addSource('focus', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  map.addLayer({
    id: 'clusters', type: 'circle', source: 'spaces', filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#2f6b3a', 'circle-opacity': 0.95,
      'circle-radius': ['step', ['get', 'point_count'], 15, 5, 18, 15, 22],
      'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff',
    },
  });
  map.addLayer({
    id: 'cluster-count', type: 'symbol', source: 'spaces', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13 },
    paint: { 'text-color': '#ffffff' },
  });
  map.addLayer({
    id: 'spaces', type: 'symbol', source: 'spaces', filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': ['concat', 'pin-', ['get', 'category']],
      'icon-allow-overlap': true,
      'symbol-sort-key': ['-', ['get', 'rank']],
      'text-field': ['step', ['zoom'], '', 14, ['get', 'name']],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 1.25],
      'text-max-width': 9,
      'text-optional': true,
    },
    paint: { 'text-color': '#3a3732', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
  });
  map.addLayer({
    id: 'focus', type: 'symbol', source: 'focus',
    layout: {
      'icon-image': ['concat', 'pin-', ['get', 'category']],
      'icon-size': ['match', ['get', 'kind'], 'selected', 1.35, 1.18],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });

  mapReady = true;
  updateMapData();
  openFromUrl();
});

// Re-add pin images if the style ever reloads.
map.on('styleimagemissing', (e) => { if (e.id.startsWith('pin-')) addPinImages(map); });

function updateMapData() {
  if (!mapReady) return;
  const features = state.spaces.filter((s) => matchesFilters(s, { ignoreView: true })).map((s) => toFeature(s));
  map.getSource('spaces').setData({ type: 'FeatureCollection', features });
  updateFocus();
}

function updateFocus() {
  if (!mapReady) return;
  const features = [];
  const hov = state.hoverId && state.hoverId !== state.selectedId && byId(state.hoverId);
  if (hov) features.push(toFeature(hov, { kind: 'hover' }));
  const sel = state.selectedId && byId(state.selectedId);
  if (sel) features.push(toFeature(sel, { kind: 'selected' }));
  map.getSource('focus').setData({ type: 'FeatureCollection', features });
}

function setHover(id) {
  if (state.hoverId === id) return;
  state.hoverId = id;
  updateFocus();
}

const hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'hover-pop', offset: 18 });
for (const layer of ['spaces', 'focus']) {
  map.on('mouseenter', layer, (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const f = e.features[0];
    const s = byId(f.properties.id);
    if (!s) return;
    hoverPopup.setLngLat(f.geometry.coordinates).setHTML(`${esc(s.name)}<small>${esc(CATEGORIES[s.category].label)} · ${openStatus(s).text}</small>`).addTo(map);
  });
  map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; hoverPopup.remove(); });
  map.on('click', layer, (e) => { hoverPopup.remove(); select(e.features[0].properties.id, { fly: false }); });
}
map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });
map.on('click', 'clusters', async (e) => {
  const f = e.features[0];
  const zoom = await map.getSource('spaces').getClusterExpansionZoom(f.properties.cluster_id);
  map.easeTo({ center: f.geometry.coordinates, zoom: zoom + 0.3 });
});
map.on('moveend', () => { if (state.inView || state.sort === 'distance') renderList(); });

// Right-click or long-press on the map to add a space there.
const contextPopup = new maplibregl.Popup({ closeButton: false, className: 'context-pop', offset: 6 });
function offerAddHere(lngLat) {
  if (!inRegion(lngLat.lng, lngLat.lat)) return toast(`This map only covers ${REGION.name}`);
  const el = document.createElement('div');
  el.innerHTML = `<button class="btn btn-primary btn-small">${icon('plus')}Add a space here</button>`;
  el.querySelector('button').onclick = () => {
    contextPopup.remove();
    requireAuth('Sign in to add a space', () => openForm(null, [lngLat.lng, lngLat.lat]));
  };
  contextPopup.setLngLat(lngLat).setDOMContent(el).addTo(map);
}
map.on('contextmenu', (e) => offerAddHere(e.lngLat));
let pressTimer;
map.on('touchstart', (e) => {
  if (e.originalEvent.touches.length !== 1) return;
  pressTimer = setTimeout(() => offerAddHere(e.lngLat), 600);
});
['touchend', 'touchmove', 'movestart'].forEach((ev) => map.on(ev, () => clearTimeout(pressTimer)));

// ---------- near me ----------
let userMarker;
$('#locateBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Location is not available in this browser');
  toast('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.userLoc = [pos.coords.longitude, pos.coords.latitude];
      if (!userMarker) {
        const el = document.createElement('div');
        el.className = 'user-dot';
        userMarker = new maplibregl.Marker({ element: el });
      }
      userMarker.setLngLat(state.userLoc).addTo(map);
      map.flyTo({ center: state.userLoc, zoom: 14 });
      state.sort = 'distance';
      onFilterChange();
      toast('Showing the closest spaces first');
    },
    () => toast("Couldn't get your location"),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

// ---------- detail ----------
function select(id, { fly = true } = {}) {
  const s = byId(id);
  if (!s) return;
  state.selectedId = id;
  renderDetail();
  updateFocus();
  const url = new URL(location.href);
  url.searchParams.set('space', id);
  history.replaceState(null, '', url);
  document.title = `${s.name} · Third Spaces Map`;
  if (isMobile()) setMobileView('detail');
  if (fly && mapReady) map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 15), speed: 1.4 });
  else if (mapReady && !map.getBounds().contains([s.lng, s.lat])) map.easeTo({ center: [s.lng, s.lat] });
}

function closeDetail() {
  state.selectedId = null;
  $('#detailView').hidden = true;
  $('#listView').hidden = false;
  updateFocus();
  const url = new URL(location.href);
  url.searchParams.delete('space');
  history.replaceState(null, '', url);
  document.title = 'Third Spaces Map · West Philadelphia Sanctuary';
  if (isMobile()) setMobileView(prevMobileView);
}

function openFromUrl() {
  const id = new URLSearchParams(location.search).get('space');
  if (id && byId(id)) select(id, { fly: true });
}

let hoursOpen = false;
function renderDetail() {
  const s = byId(state.selectedId);
  if (!s) return closeDetail();
  const cat = CATEGORIES[s.category] || CATEGORIES.other;
  const saved = state.saved.has(s.id);
  const { day } = phillyNow();
  const dist = ` · ${state.userLoc ? distLabel(s) + ' away' : distLabel(s)}`;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;
  const myBusy = store.get('busy', {})[s.id];
  const canReportBusy = !myBusy || Date.now() - myBusy > 20 * 60 * 1000;

  const view = $('#detailView');
  view.innerHTML = `
    <div class="detail-top">
      <button class="btn btn-ghost btn-small" data-act="back">${icon('back')}Back</button>
      <button class="icon-btn" data-act="back" aria-label="Close">${icon('x')}</button>
    </div>
    ${s.photos.length
      ? `<div class="gallery">${s.photos.map((p, i) => `<img src="${esc(p)}" alt="Photo ${i + 1} of ${esc(s.name)}" data-photo="${i}" />`).join('')}</div>`
      : `<div class="hero-placeholder" style="${placeholderBg(cat.color)}">${icon(s.category)}<button class="add-photo-cta" data-act="edit">${icon('camera')}Add a photo</button></div>`}
    ${s.status === 'pending' ? `<div class="notice">
      <div><strong>Waiting for review</strong>${isAdmin()
        ? `Submitted by ${esc(s.addedBy || 'someone')}. Approve it to make it public.`
        : 'Only you can see this until a moderator approves it. You can keep editing it in the meantime.'}</div>
      ${isAdmin() ? `<div class="row"><button class="btn btn-success btn-small" data-act="approve">${icon('check')}Approve</button><button class="btn btn-danger btn-small" data-act="reject">Reject</button></div>` : ''}
    </div>` : ''}
    ${isAdmin() && (s.openReports || s.pendingEditCount) ? `<div class="notice"><div><strong>Needs attention</strong>${[
      s.openReports ? `${s.openReports} open report${s.openReports > 1 ? 's' : ''}` : '',
      s.pendingEditCount ? `${s.pendingEditCount} suggested edit${s.pendingEditCount > 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(' · ')}</div><div class="row"><button class="btn btn-outline btn-small" data-act="moderate">Open moderation</button></div></div>` : ''}
    <div class="detail-head">
      <h1>${esc(s.name)}</h1>
      <div class="card-sub"><span class="cat-tag"><span class="dot" style="background:${cat.color}"></span>${esc(cat.label)}</span>${s.neighborhood ? ' · ' + esc(s.neighborhood) : ''}${dist}</div>
      <div class="card-meta">${ratingHtml(s)}<span class="sep">·</span>${statusHtml(s)}</div>
    </div>
    <div class="actions">
      <a class="action primary" href="${directions}" target="_blank" rel="noopener"><span class="ico-wrap">${icon('directions')}</span>Directions</a>
      <button class="action${saved ? ' saved' : ''}" data-act="save"><span class="ico-wrap">${icon('heart')}</span>${saved ? 'Saved' : 'Save'}</button>
      <button class="action" data-act="share"><span class="ico-wrap">${icon('share')}</span>Share</button>
      <button class="action" data-act="edit"><span class="ico-wrap">${icon('edit')}</span>${s.canEdit || !state.user ? 'Edit' : 'Suggest edit'}</button>
    </div>
    ${s.description ? `<div class="section"><p class="desc">${esc(s.description)}</p></div>` : ''}
    <div class="section">
      ${s.address ? `<div class="info-row">${icon('pin')}<span>${esc(s.address)}</span></div>` : ''}
      <div class="info-row">${icon('clock')}<div style="flex:1">
        <button class="hours-toggle" data-act="hours">${statusHtml(s)} ${icon(hoursOpen ? 'chevronLeft' : 'chevronRight')}</button>
        ${hoursOpen ? `<table class="hours-table">${DAYS.map((d) => `<tr class="${d === day ? 'today' : ''}"><td>${DAY_NAMES[d]}</td><td>${fmtRange(s.hours?.[d])}</td></tr>`).join('')}</table>` : ''}
      </div></div>
      ${s.website ? `<div class="info-row">${icon('globe')}<a href="${esc(s.website)}" target="_blank" rel="noopener">${esc(s.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a></div>` : ''}
      <div class="info-row">${icon('volume')}<span>${NOISE[s.noise] || 'Moderate'} noise level</span></div>
      <div class="info-row">${icon('wallet')}<span>${s.cost === 0 ? 'Free' : COST[s.cost] + ' typical spend'}</span></div>
    </div>
    ${s.amenities.length || s.tags.length ? `<div class="section">
      <h3>Amenities</h3>
      ${s.amenities.length ? `<div class="amenity-grid">${s.amenities.map((a) => `<div class="amenity">${icon(a)}${esc(AMENITIES[a])}</div>`).join('')}</div>` : ''}
      ${s.tags.length ? `<div class="tags">${s.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
    </div>` : ''}
    <div class="section">
      <h3>How busy is it right now? <small>Live from visitors</small></h3>
      <div class="busy-now">${s.busyNow
        ? `<span class="busy-pill busy-${s.busyNow.level}"><i></i><strong>${BUSY[s.busyNow.level].label}</strong></span><span style="color:var(--muted)">· ${s.busyNow.reports} report${s.busyNow.reports > 1 ? 's' : ''}, latest ${relTime(s.busyNow.at)}</span>`
        : '<span style="color:var(--muted)">No reports in the last 2 hours. Here now? Let others know.</span>'}</div>
      ${canReportBusy
        ? `<div class="busy-buttons">${[1, 2, 3].map((l) => `<button data-level="${l}"><span class="busy-bars"><i></i><i></i><i></i></span>${BUSY[l].label}</button>`).join('')}</div>`
        : '<p style="margin:0;color:var(--muted);font-size:13px">Thanks for your report!</p>'}
    </div>
    <div class="section">
      <h3>Reviews</h3>
      ${s.reviewCount ? `<div class="review-summary"><span class="big">${s.rating.toFixed(1)}</span><div>${stars(s.rating)}<div style="color:var(--muted);font-size:13px">${s.reviewCount} review${s.reviewCount > 1 ? 's' : ''}</div></div></div>` : ''}
      <div id="reviews">${s.reviews.slice(0, 5).map(reviewHtml).join('')}</div>
      ${s.reviews.length > 5 ? `<button class="link-btn" data-act="more-reviews">Show all ${s.reviews.length} reviews</button>` : ''}
      ${reviewFormHtml(s)}
    </div>
    <div class="detail-foot">
      <span>Added ${s.addedBy ? `by ${esc(s.addedBy)} ` : ''}${relTime(s.createdAt)}${s.updatedAt !== s.createdAt ? ` · updated ${relTime(s.updatedAt)}` : ''}</span>
      ${isAdmin() && s.status === 'approved'
        ? `<button data-act="remove">${icon('trash')}Remove space</button>`
        : `<button data-act="report">${icon('flag')}Report a problem</button>`}
    </div>`;

  $('#listView').hidden = true;
  view.hidden = false;
  bindDetail(s);
}

const reviewHtml = (r) => `<div class="review">
  <div class="review-head"><strong>${esc(r.author)}${r.mine ? ' <span class="you">(you)</span>' : ''}</strong><time>${relTime(r.at)}</time></div>
  ${stars(r.rating)}
  ${r.text ? `<p>${esc(r.text)}</p>` : ''}
  ${r.mine || isAdmin() ? `<div class="review-actions"><button data-delete-review="${r.id}">Delete</button></div>` : ''}
</div>`;

function reviewFormHtml(s) {
  if (!state.user) {
    return `<div class="signin-cta"><span>Sign in to write a review.</span><button class="btn btn-dark btn-small" data-act="signin-review">Sign in</button></div>`;
  }
  const mine = s.reviews.find((r) => r.mine);
  return `<form class="review-form" id="reviewForm">
    <strong>${mine ? 'Update your review' : s.reviewCount ? 'Add your review' : 'Be the first to review'}</strong>
    <div class="star-input" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
    <textarea name="text" rows="3" placeholder="What's it like to spend time here?" maxlength="1500">${esc(mine?.text || '')}</textarea>
    <button class="btn btn-dark btn-small" type="submit">${mine ? 'Update review' : 'Post review'}</button>
  </form>`;
}

function bindDetail(s) {
  const view = $('#detailView');
  view.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const photo = e.target.closest('[data-photo]');
    const level = e.target.closest('[data-level]');
    if (photo) return openLightbox(s.photos, Number(photo.dataset.photo));
    if (level) {
      try {
        const updated = await api(`/spaces/${s.id}/busy`, { method: 'POST', body: { level: Number(level.dataset.level) } });
        const mine = store.get('busy', {});
        mine[s.id] = Date.now();
        store.set('busy', mine);
        replaceSpace(updated);
        toast('Thanks — that helps everyone');
      } catch (err) { toast(err.message); }
      return;
    }
    const delReview = e.target.closest('[data-delete-review]');
    if (delReview) {
      if (!confirm('Delete this review?')) return;
      try {
        replaceSpace(await api(`/spaces/${s.id}/reviews/${delReview.dataset.deleteReview}`, { method: 'DELETE', body: {} }));
        toast('Review deleted');
      } catch (err) { toast(err.message); }
      return;
    }
    if (act === 'back') closeDetail();
    if (act === 'save') toggleSaved(s.id);
    if (act === 'edit') requireAuth('Sign in to edit this space or suggest changes', () => openForm(byId(s.id)));
    if (act === 'report') requireAuth('Sign in to report a problem', () => openReport(s));
    if (act === 'signin-review') openAuth('Sign in to write a review');
    if (act === 'moderate') openModeration();
    if (act === 'approve' || act === 'reject' || act === 'remove') {
      const status = { approve: 'approved', reject: 'rejected', remove: 'removed' }[act];
      if (act !== 'approve' && !confirm(act === 'remove' ? 'Remove this space from the map? You can restore it from Moderation → Removed.' : 'Reject this space?')) return;
      try {
        await setSpaceStatus(s.id, status);
        toast({ approved: 'Approved — now public', rejected: 'Space rejected', removed: 'Space removed' }[status]);
      } catch (err) { toast(err.message); }
    }
    if (act === 'hours') { hoursOpen = !hoursOpen; renderDetail(); }
    if (act === 'more-reviews') { $('#reviews').innerHTML = s.reviews.map(reviewHtml).join(''); e.target.remove(); }
    if (act === 'share') share(s);
  };

  const form = $('#reviewForm');
  if (!form) return;
  let rating = s.reviews.find((r) => r.mine)?.rating || 0;
  const starBtns = $$('[data-star]', form);
  const paint = (n) => starBtns.forEach((b) => b.classList.toggle('on', Number(b.dataset.star) <= n));
  starBtns.forEach((b) => {
    b.onmouseenter = () => paint(Number(b.dataset.star));
    b.onmouseleave = () => paint(rating);
    b.onclick = () => { rating = Number(b.dataset.star); paint(rating); };
  });
  paint(rating);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!rating) return toast('Pick a star rating first');
    try {
      const updated = await api(`/spaces/${s.id}/reviews`, { method: 'POST', body: { rating, text: form.text.value } });
      replaceSpace(updated);
      toast('Review posted');
    } catch (err) { toast(err.message); }
  };
}

async function share(s) {
  const url = `${location.origin}/?space=${s.id}`;
  if (navigator.share && isMobile()) {
    try { await navigator.share({ title: s.name, text: `${s.name} — a third space in West Philly`, url }); } catch { /* cancelled */ }
    return;
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link', url); }
}

function replaceSpace(updated) {
  const i = state.spaces.findIndex((x) => x.id === updated.id);
  const visible = updated.status === 'approved' || updated.status === 'pending';
  if (i >= 0 && visible) state.spaces[i] = updated;
  else if (i >= 0) state.spaces.splice(i, 1);
  else if (visible) state.spaces.push(updated);
  buildHoodOptions();
  renderList();
  if (state.selectedId === updated.id) visible ? renderDetail() : closeDetail();
}

async function setSpaceStatus(id, status) {
  replaceSpace(await api(`/admin/spaces/${id}`, { method: 'POST', body: { status } }));
  refreshModCount();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selectedId && !document.querySelector('dialog[open]')) closeDetail();
});

// ---------- lightbox ----------
const lb = { photos: [], i: 0 };
function openLightbox(photos, i) {
  lb.photos = photos;
  lb.i = i;
  showLb();
  $('#lightbox').showModal();
}
function showLb() {
  $('#lbImg').src = lb.photos[lb.i];
  $('#lbPrev').hidden = $('#lbNext').hidden = lb.photos.length < 2;
}
$('#lbPrev').onclick = () => { lb.i = (lb.i - 1 + lb.photos.length) % lb.photos.length; showLb(); };
$('#lbNext').onclick = () => { lb.i = (lb.i + 1) % lb.photos.length; showLb(); };
$('#lightbox').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') $('#lbPrev').click();
  if (e.key === 'ArrowRight') $('#lbNext').click();
});

// ---------- dialogs: shared close behaviour ----------
$$('dialog').forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
});

// ---------- report ----------
let reportTarget = null;
function openReport(s) {
  reportTarget = s;
  $('#reportForm').reset();
  $('#reportDialog').showModal();
}
$('#reportForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api(`/spaces/${reportTarget.id}/report`, { method: 'POST', body: { reason: f.reason.value, note: f.note.value } });
    $('#reportDialog').close();
    toast('Thanks — we’ll take a look');
  } catch (err) { toast(err.message); }
});

// ---------- add / edit form ----------
const form = $('#spaceForm');
const formState = { editing: null, category: 'cafe', amenities: new Set(), cost: 1, noise: 'moderate', photos: [], loc: null, locSet: false, autoAddress: true };
let pickMap, pickMarker;

function buildFormStatic() {
  $('#categoryPicker').innerHTML = Object.entries(CATEGORIES)
    .map(([k, c]) => `<button type="button" data-value="${k}"><span class="sw" style="background:${c.color}">${icon(k)}</span>${esc(c.label)}</button>`)
    .join('');
  $('#amenityPicker').innerHTML = Object.entries(AMENITIES)
    .map(([k, label]) => `<button type="button" class="chip" data-value="${k}">${icon(k)}${esc(label)}</button>`)
    .join('');
  $('#hoursEditor').innerHTML = DAYS.map(
    (d) => `<div class="hours-row" data-day="${d}">
      <span>${DAY_NAMES[d].slice(0, 3)}</span>
      <div class="controls">
        <select aria-label="${DAY_NAMES[d]} hours type">
          <option value="unknown">Not sure</option><option value="hours">Open</option><option value="24h">24 hours</option><option value="closed">Closed</option>
        </select>
        <input type="time" class="t-open" value="08:00" aria-label="${DAY_NAMES[d]} opens" />
        <span class="t-dash">to</span>
        <input type="time" class="t-close" value="18:00" aria-label="${DAY_NAMES[d]} closes" />
      </div>
    </div>`,
  ).join('');
  $$('.hours-row select').forEach((sel) => sel.addEventListener('change', () => syncHoursRow(sel.closest('.hours-row'))));

  $('#categoryPicker').onclick = (e) => { const b = e.target.closest('button'); if (b) { formState.category = b.dataset.value; syncFormPickers(); } };
  $('#amenityPicker').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const k = b.dataset.value;
    formState.amenities.has(k) ? formState.amenities.delete(k) : formState.amenities.add(k);
    syncFormPickers();
  };
  $('#costPicker').onclick = (e) => { const b = e.target.closest('button'); if (b) { formState.cost = Number(b.dataset.value); syncFormPickers(); } };
  $('#noisePicker').onclick = (e) => { const b = e.target.closest('button'); if (b) { formState.noise = b.dataset.value; syncFormPickers(); } };
  $('#copyHours').onclick = () => {
    const rows = $$('.hours-row');
    const [first] = rows;
    rows.slice(1).forEach((r) => {
      $('select', r).value = $('select', first).value;
      $('.t-open', r).value = $('.t-open', first).value;
      $('.t-close', r).value = $('.t-close', first).value;
      syncHoursRow(r);
    });
  };
}

function syncHoursRow(row) {
  const mode = $('select', row).value;
  $$('input, .t-dash', row).forEach((el) => (el.hidden = mode !== 'hours'));
}

function syncFormPickers() {
  $$('#categoryPicker button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === formState.category)));
  $$('#amenityPicker button').forEach((b) => b.setAttribute('aria-pressed', String(formState.amenities.has(b.dataset.value))));
  setSegmented($('#costPicker'), formState.cost);
  setSegmented($('#noisePicker'), formState.noise);
}

function setHoursEditor(hours = {}) {
  for (const row of $$('.hours-row')) {
    const h = hours[row.dataset.day] || '';
    const sel = $('select', row);
    if (!h) sel.value = 'unknown';
    else if (h === 'closed' || h === '24h') sel.value = h;
    else {
      sel.value = 'hours';
      const [o, c] = h.split('-');
      $('.t-open', row).value = o;
      $('.t-close', row).value = c;
    }
    syncHoursRow(row);
  }
}

function readHoursEditor() {
  const out = {};
  for (const row of $$('.hours-row')) {
    const mode = $('select', row).value;
    out[row.dataset.day] = mode === 'unknown' ? '' : mode === 'hours' ? `${$('.t-open', row).value}-${$('.t-close', row).value}` : mode;
  }
  return out;
}

function renderPhotoGrid() {
  const grid = $('#photoGrid');
  $$('.ph', grid).forEach((el) => el.remove());
  const add = $('.photo-add', grid);
  formState.photos.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'ph' + (p.loading ? ' loading' : '');
    el.innerHTML = p.loading ? 'Uploading…' : `<img src="${esc(p.url)}" alt="" /><button type="button" aria-label="Remove photo">${icon('x')}</button>`;
    const btn = el.querySelector('button');
    if (btn) btn.onclick = () => { formState.photos.splice(i, 1); renderPhotoGrid(); };
    grid.insertBefore(el, add);
  });
}

// Shrink photos in the browser before uploading.
async function resizeImage(file, max = 1600) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

$('#photoInput').addEventListener('change', async (e) => {
  const files = [...e.target.files].slice(0, 12 - formState.photos.length);
  e.target.value = '';
  for (const file of files) {
    const entry = { loading: true };
    formState.photos.push(entry);
    renderPhotoGrid();
    try {
      const dataUrl = await resizeImage(file);
      const { url } = await api('/uploads', { method: 'POST', body: { dataUrl } });
      entry.url = url;
      entry.loading = false;
    } catch {
      formState.photos.splice(formState.photos.indexOf(entry), 1);
      toast(`Couldn't upload ${file.name}`);
    }
    renderPhotoGrid();
  }
});

function setFormLocation(lngLat, { fly = true, reverse = true } = {}) {
  formState.loc = lngLat;
  formState.locSet = true;
  pickMarker.setLngLat(lngLat);
  if (fly) pickMap.flyTo({ center: lngLat, zoom: Math.max(pickMap.getZoom(), 16) });
  if (reverse) reverseGeocode(lngLat);
}

function ensurePickMap(center) {
  if (pickMap) return;
  pickMap = new maplibregl.Map({ container: 'pickMap', style: mapStyle, center, zoom: 15, attributionControl: { compact: true }, dragRotate: false });
  pickMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  const el = document.createElement('div');
  el.innerHTML = `<svg width="34" height="44" viewBox="0 0 34 44"><path d="M17 43s15-14.5 15-26A15 15 0 0 0 2 17c0 11.5 15 26 15 26z" fill="#2f6b3a" stroke="#fff" stroke-width="2.5"/><circle cx="17" cy="17" r="5.5" fill="#fff"/></svg>`;
  pickMarker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' }).setLngLat(center).addTo(pickMap);
  pickMarker.on('dragend', () => { const p = pickMarker.getLngLat(); setFormLocation([p.lng, p.lat], { fly: false }); });
  pickMap.on('click', (e) => setFormLocation([e.lngLat.lng, e.lngLat.lat], { fly: false }));
}

async function reverseGeocode([lng, lat]) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    applyGeocode(data);
  } catch { /* offline or rate limited; user can type the address */ }
}

function applyGeocode(r) {
  const a = r.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const hood = a.neighbourhood || a.suburb || a.quarter || a.city_district || '';
  if (formState.autoAddress || !form.address.value) {
    form.address.value = [street, a.city || a.town || 'Philadelphia', a.postcode].filter(Boolean).join(', ');
    formState.autoAddress = true;
  }
  if (!form.neighborhood.value || formState.autoHood) {
    form.neighborhood.value = hood;
    formState.autoHood = true;
  }
}
form.address.addEventListener('input', () => (formState.autoAddress = false));
form.neighborhood.addEventListener('input', () => (formState.autoHood = false));

const geoInput = $('#geoSearch');
const geoResults = $('#geoResults');
geoInput.addEventListener('input', debounce(async () => {
  const q = geoInput.value.trim();
  if (q.length < 3) { geoResults.hidden = true; return; }
  const [[w, s], [e, n]] = REGION_BBOX;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&bounded=1&viewbox=${w},${n},${e},${s}&q=${encodeURIComponent(q)}`);
    const results = (await res.json()).filter((r) => inRegion(Number(r.lon), Number(r.lat)));
    geoResults.innerHTML = results.length
      ? results.map((r, i) => `<li data-i="${i}">${esc(r.name || r.display_name.split(',')[0])}<small>${esc(r.display_name)}</small></li>`).join('')
      : `<li style="cursor:default;color:var(--muted)">No matches in ${REGION.name}</li>`;
    geoResults.hidden = false;
    geoResults.onclick = (ev) => {
      const li = ev.target.closest('[data-i]');
      if (!li) return;
      const r = results[Number(li.dataset.i)];
      setFormLocation([Number(r.lon), Number(r.lat)], { reverse: false });
      applyGeocode(r);
      if (!form.name.value && r.name) form.name.value = r.name;
      geoResults.hidden = true;
      geoInput.value = '';
    };
  } catch { geoResults.hidden = true; }
}, 400));
geoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
document.addEventListener('click', (e) => { if (!e.target.closest('.geo-search')) geoResults.hidden = true; });

function openForm(space = null, lngLat = null) {
  form.reset();
  $('#formError').hidden = true;
  geoResults.hidden = true;
  Object.assign(formState, {
    editing: space,
    category: space?.category || 'cafe',
    amenities: new Set(space?.amenities || []),
    cost: space?.cost ?? 1,
    noise: space?.noise || 'moderate',
    photos: (space?.photos || []).map((url) => ({ url })),
    loc: space ? [space.lng, space.lat] : lngLat,
    locSet: Boolean(space || lngLat),
    autoAddress: !space,
    autoHood: !space,
  });
  const suggesting = space && !space.canEdit;
  $('#formTitle').textContent = suggesting ? `Suggest changes to ${space.name}` : space ? `Edit ${space.name}` : 'Add a space';
  $('#formSubmit').textContent = suggesting ? 'Send for review' : space ? 'Save changes' : isAdmin() ? 'Add space' : 'Submit for review';
  if (space) {
    form.name.value = space.name;
    form.description.value = space.description || '';
    form.address.value = space.address || '';
    form.neighborhood.value = space.neighborhood || '';
    form.website.value = space.website || '';
    form.tags.value = (space.tags || []).join(', ');
  }
  setHoursEditor(space?.hours || {});
  syncFormPickers();
  renderPhotoGrid();
  $('#formDialog').showModal();
  $('.dialog-body', form).scrollTop = 0;

  const center = formState.loc || (inRegion(...mapCenter()) ? mapCenter() : REGION.center);
  ensurePickMap(center);
  pickMap.resize();
  pickMap.jumpTo({ center, zoom: formState.locSet ? 16.5 : 14 });
  pickMarker.setLngLat(center);
  if (lngLat) reverseGeocode(lngLat);
}

$('#addBtn').addEventListener('click', () => requireAuth('Sign in to add a space', () => openForm()));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#formError');
  const fail = (msg) => { err.textContent = msg; err.hidden = false; err.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  if (!form.name.value.trim()) return fail('Please give the space a name.');
  if (!formState.locSet) return fail('Please set the location — search an address, click the map, or drag the pin.');
  if (!inRegion(formState.loc[0], formState.loc[1])) return fail(`This map only covers ${REGION.name}. Move the pin to a spot between the Schuylkill and Cobbs Creek.`);
  if (formState.photos.some((p) => p.loading)) return fail('Photos are still uploading — one moment.');

  const body = {
    name: form.name.value,
    category: formState.category,
    description: form.description.value,
    address: form.address.value,
    neighborhood: form.neighborhood.value,
    website: form.website.value,
    lng: formState.loc[0],
    lat: formState.loc[1],
    cost: formState.cost,
    noise: formState.noise,
    amenities: [...formState.amenities],
    tags: form.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    hours: readHoursEditor(),
    photos: formState.photos.map((p) => p.url),
  };

  const btn = $('#formSubmit');
  btn.disabled = true;
  try {
    const result = formState.editing
      ? await api(`/spaces/${formState.editing.id}`, { method: 'PUT', body })
      : await api('/spaces', { method: 'POST', body });
    $('#formDialog').close();
    if (result.suggested) {
      toast('Thanks — a moderator will review your suggested changes');
      refreshModCount();
      return;
    }
    replaceSpace(result.space);
    toast(
      formState.editing ? 'Changes saved'
        : result.pending ? 'Thanks! Your space will appear for everyone once a moderator approves it'
        : 'Space added',
    );
    select(result.space.id, { fly: true });
    refreshModCount();
  } catch (ex) {
    fail(ex.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------- accounts (sign-in itself lives in site.js) ----------
onUserChange(async (user) => {
  state.user = user;
  if (!user) state.mineOnly = false;
  await refreshSpaces();
  if (user?.role === 'admin') refreshModCount();
});

async function refreshSpaces() {
  try {
    state.spaces = await api('/spaces');
  } catch {
    toast("Couldn't load spaces — is the server running?");
  }
  buildHoodOptions();
  renderList();
  if (state.selectedId) byId(state.selectedId) ? renderDetail() : closeDetail();
}

function addMapMenuItems() {
  addMenuItem({ id: 'menuMine', iconName: 'pin', label: 'Spaces I added', onClick: () => {
    if (state.selectedId) closeDetail();
    state.mineOnly = true;
    if (isMobile()) setMobileView('list');
    renderList();
  } });
  addMenuItem({ id: 'menuSaved', iconName: 'heart', label: 'Saved spaces', onClick: () => {
    if (state.selectedId) closeDetail();
    state.savedOnly = true;
    if (isMobile()) setMobileView('list');
    onFilterChange();
  } });
  addMenuItem({ id: 'menuModerate', iconName: 'shield', label: 'Map moderation', adminOnly: true, onClick: () => openModeration() });
}

// ---------- moderation ----------
const mod = { tab: 'spaces', queue: null, users: null, userQuery: '' };

async function refreshModCount() {
  if (!isAdmin()) return;
  try {
    mod.queue = await api('/admin/queue');
  } catch { return; }
  const q = mod.queue;
  const counts = { spaces: q.pendingSpaces.length, edits: q.edits.length, reports: q.reports.length };
  const total = counts.spaces + counts.edits + counts.reports;
  const badge = $('#menuModerate .badge');
  if (badge) { badge.hidden = !total; badge.textContent = total; }
  refreshAdminCount();
  for (const [tab, n] of Object.entries(counts)) $(`#modTabs [data-tab="${tab}"] .count`).textContent = n || '';
}

async function openModeration(tab) {
  await refreshModCount();
  const q = mod.queue;
  mod.tab = tab || (q.pendingSpaces.length ? 'spaces' : q.edits.length ? 'edits' : q.reports.length ? 'reports' : 'spaces');
  await renderMod();
  if (!$('#modDialog').open) $('#modDialog').showModal();
}

$('#modTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) { mod.tab = b.dataset.tab; renderMod(); }
});

const REPORT_REASONS = {
  closed: 'Permanently closed', 'wrong-info': 'Wrong hours or info', 'wrong-location': 'Wrong location',
  'not-a-third-space': 'Not really a third space', other: 'Something else',
};
const FIELD_LABELS = {
  name: 'Name', category: 'Category', description: 'Description', address: 'Address', neighborhood: 'Neighborhood',
  website: 'Website', location: 'Location', cost: 'Typical spend', noise: 'Noise', amenities: 'Amenities', tags: 'Tags', hours: 'Hours', photos: 'Photos',
};
const emptyState = (text) => `<div class="mod-empty">${icon('check')}<p>${esc(text)}</p></div>`;
const by = (name, at) => `${name ? `by ${esc(name)} · ` : ''}${relTime(at)}`;

function fmtField(key, v) {
  if (key === 'category') return CATEGORIES[v]?.label || v;
  if (key === 'cost') return COST[v];
  if (key === 'noise') return NOISE[v];
  if (key === 'amenities') return v.map((a) => AMENITIES[a]).join(', ') || 'None';
  if (key === 'tags') return v.join(', ') || 'None';
  return v || '(empty)';
}

function diffHtml(cur, next) {
  const rows = [];
  for (const key of ['name', 'category', 'description', 'address', 'neighborhood', 'website', 'cost', 'noise', 'amenities', 'tags']) {
    if (JSON.stringify(cur[key]) === JSON.stringify(next[key])) continue;
    rows.push(`<div class="diff-row"><span>${FIELD_LABELS[key]}</span><span><del>${esc(fmtField(key, cur[key]))}</del> <ins>${esc(fmtField(key, next[key]))}</ins></span></div>`);
  }
  const moved = milesBetween([cur.lng, cur.lat], [next.lng, next.lat]);
  if (moved > 0.001) rows.push(`<div class="diff-row"><span>Location</span><span><ins>Pin moved ${fmtMiles(moved)}</ins></span></div>`);
  const hourChanges = DAYS.filter((d) => (cur.hours?.[d] || '') !== (next.hours?.[d] || ''));
  if (hourChanges.length) {
    rows.push(`<div class="diff-row"><span>Hours</span><span>${hourChanges.map((d) => `${DAY_NAMES[d].slice(0, 3)}: <del>${fmtRange(cur.hours?.[d])}</del> <ins>${fmtRange(next.hours?.[d])}</ins>`).join('<br>')}</span></div>`);
  }
  const added = next.photos.filter((p) => !cur.photos.includes(p));
  const removed = cur.photos.filter((p) => !next.photos.includes(p));
  if (added.length || removed.length) {
    rows.push(`<div class="diff-row"><span>Photos</span><div class="mod-photos">${added.map((p) => `<img class="added" src="${esc(p)}" alt="Added photo" />`).join('')}${removed.map((p) => `<img class="removed" src="${esc(p)}" alt="Removed photo" />`).join('')}</div></div>`);
  }
  return rows.length ? `<div class="diff">${rows.join('')}</div>` : '<p class="mod-desc">No changes from the current version.</p>';
}

async function renderMod() {
  $$('#modTabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === mod.tab)));
  const body = $('#modBody');
  const q = mod.queue;
  let html = '';

  if (mod.tab === 'spaces') {
    html = q.pendingSpaces.length ? q.pendingSpaces.map((s) => `<div class="mod-item">
      <div class="mod-item-head">
        <div><h4>${esc(s.name)}</h4><small>${esc(CATEGORIES[s.category]?.label)}${s.neighborhood ? ' · ' + esc(s.neighborhood) : ''} · submitted ${by(s.submittedBy, s.createdAt)}</small></div>
        <div class="mod-actions">
          <button class="btn btn-outline btn-small" data-mod="view" data-id="${s.id}">View on map</button>
          <button class="btn btn-danger btn-small" data-mod="status" data-status="rejected" data-id="${s.id}">Reject</button>
          <button class="btn btn-success btn-small" data-mod="status" data-status="approved" data-id="${s.id}">${icon('check')}Approve</button>
        </div>
      </div>
      ${s.description ? `<p class="mod-desc">${esc(s.description)}</p>` : ''}
      ${s.address ? `<small style="color:var(--muted)">${esc(s.address)}</small>` : ''}
      ${s.photos.length ? `<div class="mod-photos">${s.photos.map((p) => `<img src="${esc(p)}" alt="" />`).join('')}</div>` : ''}
    </div>`).join('') : emptyState('No new spaces waiting for review.');
  }

  if (mod.tab === 'edits') {
    html = q.edits.length ? q.edits.map((e) => `<div class="mod-item">
      <div class="mod-item-head">
        <div><h4>${esc(e.spaceName)}</h4><small>Suggested ${by(e.by, e.at)}</small></div>
        <div class="mod-actions">
          <button class="btn btn-outline btn-small" data-mod="view" data-id="${e.spaceId}">View space</button>
          <button class="btn btn-danger btn-small" data-mod="edit" data-action="reject" data-id="${e.spaceId}" data-edit="${e.id}">Reject</button>
          <button class="btn btn-success btn-small" data-mod="edit" data-action="approve" data-id="${e.spaceId}" data-edit="${e.id}">${icon('check')}Apply</button>
        </div>
      </div>
      ${diffHtml(e.current, e.changes)}
    </div>`).join('') : emptyState('No suggested edits to review.');
  }

  if (mod.tab === 'reports') {
    html = q.reports.length ? q.reports.map((r) => `<div class="mod-item">
      <div class="mod-item-head">
        <div><h4>${esc(r.spaceName)}</h4><small>${esc(REPORT_REASONS[r.reason] || r.reason)} · reported ${by(r.by, r.at)}</small></div>
        <div class="mod-actions">
          <button class="btn btn-outline btn-small" data-mod="view" data-id="${r.spaceId}">View space</button>
          ${r.spaceStatus === 'approved' ? `<button class="btn btn-danger btn-small" data-mod="remove-from-report" data-id="${r.spaceId}" data-report="${r.id}">Remove space</button>` : ''}
          <button class="btn btn-outline btn-small" data-mod="report" data-action="dismissed" data-id="${r.spaceId}" data-report="${r.id}">Dismiss</button>
          <button class="btn btn-success btn-small" data-mod="report" data-action="resolved" data-id="${r.spaceId}" data-report="${r.id}">${icon('check')}Resolved</button>
        </div>
      </div>
      ${r.note ? `<p class="mod-desc">“${esc(r.note)}”</p>` : ''}
    </div>`).join('') : emptyState('No open reports.');
  }

  if (mod.tab === 'removed') {
    html = q.removed.length ? q.removed.map((s) => `<div class="user-row">
      <div><strong>${esc(s.name)}</strong><small>${s.status === 'rejected' ? 'Rejected' : 'Removed'} ${relTime(s.updatedAt)}</small></div>
      <button class="btn btn-outline btn-small" data-mod="status" data-status="approved" data-id="${s.id}">Restore</button>
    </div>`).join('') : emptyState('Nothing has been removed.');
  }

  if (mod.tab === 'users') {
    if (!mod.users) {
      body.innerHTML = '<p class="mod-empty">Loading…</p>';
      try { mod.users = await api('/admin/users'); } catch (err) { body.innerHTML = `<p class="mod-empty">${esc(err.message)}</p>`; return; }
    }
    const term = mod.userQuery.toLowerCase();
    const users = mod.users.filter((u) => !term || `${u.name} ${u.email}`.toLowerCase().includes(term));
    html = `<input class="mod-search" id="userSearch" type="search" placeholder="Search people by name or email" value="${esc(mod.userQuery)}" />` +
      users.map((u) => `<div class="user-row">
        <div>
          <strong>${esc(u.name)}</strong>${u.role === 'admin' ? '<span class="tag-admin">Moderator</span>' : ''}${u.banned ? '<span class="tag-banned">Suspended</span>' : ''}
          <small>${esc(u.email)} · joined ${relTime(u.createdAt)} · ${u.spaces} space${u.spaces === 1 ? '' : 's'}, ${u.reviews} review${u.reviews === 1 ? '' : 's'}</small>
        </div>
        ${u.id === state.user.id ? '<small style="color:var(--muted)">You</small>' : `<div class="mod-actions">
          <button class="btn btn-outline btn-small" data-mod="user" data-id="${u.id}" data-role="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'Remove moderator' : 'Make moderator'}</button>
          <button class="btn ${u.banned ? 'btn-outline' : 'btn-danger'} btn-small" data-mod="user" data-id="${u.id}" data-banned="${!u.banned}">${u.banned ? 'Unsuspend' : 'Suspend'}</button>
        </div>`}
      </div>`).join('');
  }

  body.innerHTML = html;
  const search = $('#userSearch');
  if (search) {
    search.oninput = debounce(() => { mod.userQuery = search.value; renderMod().then(() => { const s = $('#userSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }); }, 200);
  }
}

$('#modBody').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-mod]');
  if (!b) return;
  const { mod: kind, id } = b.dataset;
  if (kind === 'view') {
    $('#modDialog').close();
    if (!byId(id)) await refreshSpaces();
    select(id, { fly: true });
    return;
  }
  b.disabled = true;
  try {
    if (kind === 'status') await setSpaceStatus(id, b.dataset.status);
    if (kind === 'edit') replaceSpace(await api(`/admin/spaces/${id}/edits/${b.dataset.edit}`, { method: 'POST', body: { action: b.dataset.action } }));
    if (kind === 'report') await api(`/admin/spaces/${id}/reports/${b.dataset.report}`, { method: 'POST', body: { action: b.dataset.action } });
    if (kind === 'remove-from-report') {
      if (!confirm('Remove this space from the map? You can restore it later.')) { b.disabled = false; return; }
      await api(`/admin/spaces/${id}/reports/${b.dataset.report}`, { method: 'POST', body: { action: 'resolved' } });
      await setSpaceStatus(id, 'removed');
    }
    if (kind === 'user') {
      const change = b.dataset.role ? { role: b.dataset.role } : { banned: b.dataset.banned === 'true' };
      if (change.banned && !confirm('Suspend this person? They will be signed out and unable to post.')) { b.disabled = false; return; }
      await api(`/admin/users/${id}`, { method: 'POST', body: change });
      mod.users = null;
    }
    await refreshModCount();
    await renderMod();
  } catch (err) {
    toast(err.message);
    b.disabled = false;
  }
});

// ---------- boot ----------
$$('[data-icon]').forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
buildFilters();
buildFormStatic();
syncFilterUI();

state.user = await initSite('map');
addMapMenuItems();
await refreshSpaces();
if (isAdmin()) {
  await refreshModCount();
  if (new URLSearchParams(location.search).has('moderate')) openModeration();
}
if (mapReady) openFromUrl();

// Keep "Open now" labels fresh.
setInterval(() => {
  renderList();
  const typing = $('#detailView').contains(document.activeElement);
  if (state.selectedId && !typing && !document.querySelector('dialog[open]')) renderDetail();
}, 60 * 1000);
