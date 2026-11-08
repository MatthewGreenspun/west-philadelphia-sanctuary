import {
  $, $$, esc, api, toast, initSite, onUserChange, openAuth, hydrateIcons, wireDialog, refreshAdminCount, relTime,
  fmtWhen, where, signupSummary, uploadPhoto,
} from '../site.js';
import { icon, VOLUNTEER } from '../config.js';

const params = new URLSearchParams(location.search);
const state = {
  tab: params.get('tab') || 'events',
  focusEvent: params.get('event'),
  events: [],
  openSignups: new Set(),
  signups: new Map(),
  volunteers: [],
  volFilter: 'new',
  volQuery: '',
  photos: [],
  site: null,
  summary: null,
  spaces: null,
};

// ---------- gate ----------
async function boot(user) {
  const ok = user?.role === 'admin';
  $('#adminApp').hidden = !ok;
  $('#gate').hidden = ok;
  if (!ok) {
    $('#gate').innerHTML = user
      ? `${icon('shield')}<strong>Admins only</strong><p>This page is for club officers. Ask an admin to give your account access from Map → Moderation → People.</p>`
      : `${icon('shield')}<strong>Sign in to manage the club site</strong><p>This page is for club officers.</p><button class="btn btn-primary btn-small" id="gateSignIn">Sign in</button>`;
    $('#gateSignIn')?.addEventListener('click', () => openAuth('Sign in with your officer account'));
    return;
  }
  await refreshCounts();
  await showTab(state.tab);
}

async function refreshCounts() {
  state.summary = await refreshAdminCount();
  if (!state.summary) return;
  const m = state.summary.map;
  $('#adminTabs [data-tab="volunteers"] .count').textContent = state.summary.newVolunteers || '';
  $('#adminTabs [data-tab="map"] .count').textContent = (m.spaces + m.edits + m.reports) || '';
}

$('#adminTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) showTab(b.dataset.tab);
});

async function showTab(tab) {
  state.tab = tab;
  $$('#adminTabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  const url = new URL(location.href);
  url.searchParams.set('tab', tab);
  if (tab !== 'events') url.searchParams.delete('event');
  history.replaceState(null, '', url);
  $('#adminBody').innerHTML = '<p class="muted">Loading…</p>';
  try {
    await ({ events: loadEvents, volunteers: loadVolunteers, gallery: loadGallery, site: loadSite, map: renderMap })[tab]();
  } catch (err) {
    $('#adminBody').innerHTML = `<div class="empty-card"><p>${esc(err.message)}</p></div>`;
  }
}

// ======================= events =======================
async function loadEvents() {
  state.events = await api('/events');
  if (state.focusEvent) {
    state.openSignups.add(state.focusEvent);
    await loadSignups(state.focusEvent);
  }
  renderEvents();
  if (state.focusEvent) {
    document.getElementById(`ev-${state.focusEvent}`)?.scrollIntoView({ block: 'start' });
    state.focusEvent = null;
  }
}

async function loadSignups(id) {
  state.signups.set(id, await api(`/admin/events/${id}/signups`));
}

function renderEvents() {
  const upcoming = state.events.filter((e) => !e.past);
  const past = state.events.filter((e) => e.past).reverse();
  const row = (e) => {
    const open = state.openSignups.has(e.id);
    const list = state.signups.get(e.id) || [];
    const total = e.counts.going + e.counts.interested + e.counts.waitlist;
    return `<div class="admin-row" id="ev-${esc(e.id)}">
      <div class="admin-row-head">
        <div>
          <h3>${esc(e.title)} ${e.published ? '' : '<span class="pill-pending">Draft</span>'}</h3>
          <small>${esc(fmtWhen(e))}${where(e) ? ` · ${esc(where(e))}` : ''}</small>
          <small>${e.signupMode === 'none' ? 'No sign-ups' : esc(signupSummary(e) || 'No sign-ups yet')}${e.counts.waitlist ? ` · ${e.counts.waitlist} on waitlist` : ''}</small>
        </div>
        <div class="mod-actions">
          ${e.signupMode !== 'none' || total ? `<button class="btn btn-outline btn-small" data-act="signups" data-id="${esc(e.id)}">${open ? 'Hide' : 'Sign-ups'} (${total})</button>` : ''}
          <button class="btn btn-outline btn-small" data-act="edit" data-id="${esc(e.id)}">${icon('edit')}Edit</button>
          <a class="btn btn-ghost btn-small" href="/events?event=${esc(e.id)}" target="_blank">View</a>
          <button class="btn btn-danger btn-small" data-act="delete" data-id="${esc(e.id)}" aria-label="Delete">${icon('trash')}</button>
        </div>
      </div>
      ${open ? signupsHtml(e, list) : ''}
    </div>`;
  };
  $('#adminBody').innerHTML = `
    <div class="admin-toolbar">
      <div class="left"><strong>${upcoming.length} upcoming</strong><span class="muted">· ${past.length} past</span></div>
      <button class="btn btn-primary btn-small" data-act="new">${icon('plus')}New event</button>
    </div>
    ${upcoming.length ? `<div class="admin-list">${upcoming.map(row).join('')}</div>`
      : `<div class="empty-card">${icon('calendar')}<strong>No upcoming events</strong><p>Create one and it will show up on the home page and events calendar.</p></div>`}
    ${past.length ? `<h3 style="margin:28px 0 12px;font-size:15px">Past events</h3><div class="admin-list">${past.map(row).join('')}</div>` : ''}`;
}

function signupsHtml(e, list) {
  if (!list.length) return '<p class="muted" style="margin:0">Nobody has signed up yet.</p>';
  const opts = (cur) => ['going', 'interested', 'waitlist'].map((s) => `<option value="${s}"${s === cur ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('');
  return `<div class="table-wrap"><table class="signup-table">
      <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Note</th><th>Signed up</th><th></th></tr></thead>
      <tbody>${list.map((s) => `<tr>
        <td>${esc(s.name)}</td><td><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></td>
        <td><select data-signup-status="${esc(s.id)}" data-event="${esc(e.id)}" aria-label="Status">${opts(s.status)}</select></td>
        <td>${esc(s.note)}</td><td>${esc(relTime(s.createdAt))}</td>
        <td><button class="link-btn" data-act="remove-signup" data-id="${esc(s.id)}" data-event="${esc(e.id)}">Remove</button></td>
      </tr>`).join('')}</tbody></table></div>
    <div class="row-between">
      <button class="btn btn-ghost btn-small" data-act="copy-emails" data-id="${esc(e.id)}">Copy emails of people going</button>
      <a class="btn btn-outline btn-small" href="/api/admin/events/${esc(e.id)}/signups.csv">${icon('download')}Download CSV</a>
    </div>`;
}

$('#adminBody').addEventListener('click', async (ev) => {
  if (state.tab !== 'events') return;
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  const id = b.dataset.id;
  const e = state.events.find((x) => x.id === id);
  try {
    if (b.dataset.act === 'new') openEventForm();
    if (b.dataset.act === 'edit') openEventForm(e);
    if (b.dataset.act === 'signups') {
      if (state.openSignups.has(id)) state.openSignups.delete(id);
      else { state.openSignups.add(id); await loadSignups(id); }
      renderEvents();
    }
    if (b.dataset.act === 'delete') {
      const n = e.counts.going + e.counts.interested + e.counts.waitlist;
      if (!confirm(`Delete “${e.title}”?${n ? ` Its ${n} sign-up${n === 1 ? '' : 's'} will be deleted too.` : ''} Photos stay in the gallery. This can’t be undone.`)) return;
      await api(`/admin/events/${id}`, { method: 'DELETE', body: {} });
      toast('Event deleted');
      await loadEvents();
    }
    if (b.dataset.act === 'remove-signup') {
      if (!confirm('Remove this person from the event?')) return;
      await api(`/admin/events/${b.dataset.event}/signups/${id}`, { method: 'DELETE', body: {} });
      await refreshEvent(b.dataset.event);
    }
    if (b.dataset.act === 'copy-emails') {
      const emails = (state.signups.get(id) || []).filter((s) => s.status === 'going').map((s) => s.email).join(', ');
      if (!emails) return toast('Nobody is marked as going yet');
      try { await navigator.clipboard.writeText(emails); toast('Emails copied'); } catch { prompt('Copy these emails', emails); }
    }
  } catch (err) { toast(err.message); }
});

$('#adminBody').addEventListener('change', async (ev) => {
  const sel = ev.target.closest('[data-signup-status]');
  if (!sel) return;
  try {
    await api(`/admin/events/${sel.dataset.event}/signups/${sel.dataset.signupStatus}`, { method: 'POST', body: { status: sel.value } });
    await refreshEvent(sel.dataset.event);
    toast('Updated');
  } catch (err) { toast(err.message); }
});

async function refreshEvent(id) {
  state.events = await api('/events');
  await loadSignups(id);
  renderEvents();
}

// ---------- event form ----------
const eventDialog = $('#eventDialog');
const eventForm = $('#eventForm');
wireDialog(eventDialog);
let editing = null;
let cover = '';

function renderCover() {
  $('#coverGrid').innerHTML = cover
    ? `<div class="ph"><img src="${esc(cover)}" alt="" /><button type="button" data-remove-cover aria-label="Remove photo">${icon('x')}</button></div>`
    : `<label class="photo-add"><input type="file" id="coverInput" accept="image/jpeg,image/png,image/webp" hidden />${icon('camera')}<span>Add a photo</span></label>`;
}
$('#coverGrid').addEventListener('click', (e) => { if (e.target.closest('[data-remove-cover]')) { cover = ''; renderCover(); } });
$('#coverGrid').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  $('#coverGrid').innerHTML = '<div class="ph loading">Uploading…</div>';
  try { cover = await uploadPhoto(file); } catch (err) { toast(err.message); }
  renderCover();
});

async function openEventForm(e = null) {
  editing = e;
  eventForm.reset();
  $('#eventError').hidden = true;
  $('#eventFormTitle').textContent = e ? 'Edit event' : 'New event';
  if (!state.spaces) {
    try { state.spaces = (await api('/spaces')).filter((s) => s.status === 'approved').sort((a, b) => a.name.localeCompare(b.name)); } catch { state.spaces = []; }
    $('#spaceSelect').insertAdjacentHTML('beforeend', state.spaces.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join(''));
  }
  const f = eventForm;
  if (e) {
    f.title.value = e.title; f.summary.value = e.summary; f.description.value = e.description;
    f.startsAt.value = e.startsAt; f.endsAt.value = e.endsAt || '';
    f.spaceId.value = e.spaceId || ''; f.location.value = e.location; f.address.value = e.address;
    f.signupMode.value = e.signupMode; f.capacity.value = e.capacity || ''; f.link.value = e.link; f.published.checked = e.published;
  }
  cover = e?.cover || '';
  renderCover();
  eventDialog.showModal();
  f.title.focus();
}

// Picking a third space fills in the place name and address if they're empty.
$('#spaceSelect').addEventListener('change', () => {
  const s = state.spaces.find((x) => x.id === $('#spaceSelect').value);
  if (!s) return;
  if (!eventForm.location.value) eventForm.location.value = s.name;
  if (!eventForm.address.value) eventForm.address.value = s.address || '';
});
// New events: default the end to two hours after the start.
eventForm.startsAt.addEventListener('change', () => {
  const v = eventForm.startsAt.value;
  if (!v || eventForm.endsAt.value) return;
  const d = new Date(v + ':00Z');
  d.setUTCHours(d.getUTCHours() + 2);
  eventForm.endsAt.value = d.toISOString().slice(0, 16);
});

eventForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = eventForm;
  const body = {
    title: f.title.value, summary: f.summary.value, description: f.description.value,
    startsAt: f.startsAt.value, endsAt: f.endsAt.value, spaceId: f.spaceId.value, location: f.location.value, address: f.address.value,
    cover, signupMode: f.signupMode.value, capacity: f.capacity.value, link: f.link.value, published: f.published.checked,
  };
  $('#eventSubmit').disabled = true;
  try {
    await api(editing ? `/admin/events/${editing.id}` : '/admin/events', { method: editing ? 'PUT' : 'POST', body });
    eventDialog.close();
    toast(editing ? 'Event updated' : body.published ? 'Event published' : 'Draft saved');
    await loadEvents();
  } catch (err) {
    $('#eventError').textContent = err.message;
    $('#eventError').hidden = false;
  } finally {
    $('#eventSubmit').disabled = false;
  }
});

// ======================= volunteers =======================
async function loadVolunteers() {
  state.volunteers = await api('/admin/volunteers');
  if (!state.volunteers.some((v) => v.status === 'new') && state.volFilter === 'new') state.volFilter = '';
  renderVolunteers();
}

function renderVolunteers() {
  const q = state.volQuery.toLowerCase();
  const list = state.volunteers.filter((v) => (!state.volFilter || v.status === state.volFilter)
    && (!q || [v.name, v.email, v.school, v.message].some((x) => x.toLowerCase().includes(q))));
  const count = (s) => state.volunteers.filter((v) => !s || v.status === s).length;
  const filters = [['', 'All'], ...Object.entries(VOLUNTEER.status)]
    .map(([v, l]) => `<button data-vol-filter="${v}" aria-pressed="${state.volFilter === v}">${l} (${count(v)})</button>`).join('');
  const label = (group, v) => VOLUNTEER[group][v] || v;
  $('#adminBody').innerHTML = `
    <div class="admin-toolbar">
      <div class="left"><div class="segmented">${filters}</div></div>
      <div class="left">
        <input class="mod-search" style="margin:0;width:200px" id="volSearch" type="search" placeholder="Search…" value="${esc(state.volQuery)}" />
        <a class="btn btn-outline btn-small" href="/api/admin/volunteers.csv">${icon('download')}CSV</a>
      </div>
    </div>
    ${list.length ? `<div class="admin-list">${list.map((v) => `
      <div class="admin-row">
        <div class="admin-row-head">
          <div><h3>${esc(v.name)} <span class="status-pill status-${v.status}">${VOLUNTEER.status[v.status]}</span></h3>
            <small><a href="mailto:${esc(v.email)}">${esc(v.email)}</a>${v.phone ? ` · ${esc(v.phone)}` : ''} · sent ${esc(relTime(v.createdAt))}</small></div>
          <div class="mod-actions">
            <select class="select-small" data-vol-status="${esc(v.id)}" aria-label="Status">${Object.entries(VOLUNTEER.status).map(([s, l]) => `<option value="${s}"${s === v.status ? ' selected' : ''}>${l}</option>`).join('')}</select>
            <button class="btn btn-danger btn-small" data-vol-delete="${esc(v.id)}" aria-label="Delete">${icon('trash')}</button>
          </div>
        </div>
        <dl>
          ${v.affiliation ? `<dt>Who</dt><dd>${esc(label('affiliation', v.affiliation))}${v.school ? ` · ${esc(v.school)}` : ''}</dd>` : v.school ? `<dt>School</dt><dd>${esc(v.school)}</dd>` : ''}
          <dt>Wants to help with</dt><dd><span class="chip-tags">${v.interests.map((i) => `<span class="tag">${esc(label('interests', i))}</span>`).join('')}</span></dd>
          ${v.availability.length ? `<dt>Free</dt><dd>${esc(v.availability.map((a) => label('availability', a)).join(', '))}</dd>` : ''}
          ${v.howHeard ? `<dt>Heard via</dt><dd>${esc(v.howHeard)}</dd>` : ''}
          ${v.message ? `<dt>Message</dt><dd>${esc(v.message)}</dd>` : ''}
        </dl>
        <textarea data-vol-notes="${esc(v.id)}" placeholder="Officer notes (only admins see these)">${esc(v.notes)}</textarea>
      </div>`).join('')}</div>`
      : `<div class="empty-card">${icon('hand')}<strong>${state.volunteers.length ? 'Nobody here' : 'No volunteer forms yet'}</strong><p>${state.volunteers.length ? 'Try another filter.' : 'Forms sent from the Volunteer page will show up here.'}</p></div>`}`;
  $('#volSearch').addEventListener('input', (e) => {
    state.volQuery = e.target.value;
    const pos = e.target.selectionStart;
    renderVolunteers();
    const input = $('#volSearch');
    input.focus();
    input.setSelectionRange(pos, pos);
  });
}

async function updateVolunteer(id, body) {
  const updated = await api(`/admin/volunteers/${id}`, { method: 'PUT', body });
  state.volunteers = state.volunteers.map((v) => (v.id === id ? updated : v));
  refreshCounts();
}

$('#adminBody').addEventListener('click', async (e) => {
  if (state.tab !== 'volunteers') return;
  const f = e.target.closest('[data-vol-filter]');
  if (f) { state.volFilter = f.dataset.volFilter; renderVolunteers(); }
  const del = e.target.closest('[data-vol-delete]');
  if (del) {
    if (!confirm('Delete this volunteer form permanently? This can’t be undone.')) return;
    try {
      await api(`/admin/volunteers/${del.dataset.volDelete}`, { method: 'DELETE', body: {} });
      state.volunteers = state.volunteers.filter((v) => v.id !== del.dataset.volDelete);
      renderVolunteers();
      refreshCounts();
      toast('Deleted');
    } catch (err) { toast(err.message); }
  }
});
$('#adminBody').addEventListener('change', async (e) => {
  if (state.tab !== 'volunteers') return;
  const s = e.target.closest('[data-vol-status]');
  if (!s) return;
  try {
    await updateVolunteer(s.dataset.volStatus, { status: s.value });
    renderVolunteers();
    toast(`Marked as ${VOLUNTEER.status[s.value].toLowerCase()}`);
  } catch (err) { toast(err.message); }
});
// Notes save when you click away.
$('#adminBody').addEventListener('focusout', async (e) => {
  const t = e.target.closest('[data-vol-notes]');
  if (!t) return;
  const v = state.volunteers.find((x) => x.id === t.dataset.volNotes);
  if (!v || v.notes === t.value) return;
  try { await updateVolunteer(v.id, { notes: t.value }); toast('Notes saved'); } catch (err) { toast(err.message); }
});

// ======================= gallery =======================
async function loadGallery() {
  [state.photos, state.events] = await Promise.all([api('/admin/gallery'), api('/events')]);
  renderGallery();
}

function eventOptions(selected = '') {
  const sorted = [...state.events].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return `<option value="">Not tied to an event</option>${sorted.map((e) =>
    `<option value="${esc(e.id)}"${e.id === selected ? ' selected' : ''}>${esc(e.title)} (${esc(e.startsAt.slice(0, 10))})</option>`).join('')}`;
}

function renderGallery() {
  const pastFirst = state.events.filter((e) => e.past).sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
  $('#adminBody').innerHTML = `
    <div class="aside-card" style="margin-bottom:20px">
      <h3>Add photos</h3>
      <div class="grid-2">
        <label class="field"><span>From which event?</span><select class="select-small" style="height:40px" id="uploadEvent">${eventOptions(pastFirst?.id)}</select></label>
        <div class="field"><span>Photos</span>
          <label class="btn btn-primary" style="justify-self:start">${icon('camera')}Choose photos<input type="file" id="galleryInput" accept="image/jpeg,image/png,image/webp" multiple hidden /></label>
        </div>
      </div>
      <p class="field-hint" id="uploadStatus" style="margin:0">Photos are resized in your browser before uploading. Only post photos people are OK with sharing.</p>
    </div>
    ${state.photos.length ? `<div class="admin-photos">${state.photos.map((p) => `
      <div class="admin-photo">
        <img src="${esc(p.url)}" alt="" loading="lazy" />
        <div class="ap-body">
          <input data-photo-caption="${esc(p.id)}" value="${esc(p.caption)}" placeholder="Caption" maxlength="300" />
          <select data-photo-event="${esc(p.id)}" aria-label="Event">${eventOptions(p.eventId || '')}</select>
          <div class="row-between"><span></span><button class="link-btn" style="color:var(--red)" data-photo-delete="${esc(p.id)}">Delete</button></div>
        </div>
      </div>`).join('')}</div>`
      : `<div class="empty-card">${icon('image')}<strong>No photos yet</strong><p>Add photos from past events to fill the gallery.</p></div>`}`;

  $('#galleryInput').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const eventId = $('#uploadEvent').value;
    const urls = [];
    for (const [i, file] of files.entries()) {
      $('#uploadStatus').textContent = `Uploading ${i + 1} of ${files.length}…`;
      try { urls.push(await uploadPhoto(file, 2000)); } catch { toast(`Couldn’t upload ${file.name}`); }
    }
    if (!urls.length) return renderGallery();
    try {
      state.photos = await api('/admin/gallery', { method: 'POST', body: { photos: urls.map((url) => ({ url, eventId })) } });
      toast(`Added ${urls.length} photo${urls.length === 1 ? '' : 's'}`);
    } catch (err) { toast(err.message); }
    renderGallery();
  });
}

$('#adminBody').addEventListener('change', async (e) => {
  if (state.tab !== 'gallery') return;
  const cap = e.target.closest('[data-photo-caption]');
  const evSel = e.target.closest('[data-photo-event]');
  try {
    if (cap) { await api(`/admin/gallery/${cap.dataset.photoCaption}`, { method: 'PUT', body: { caption: cap.value } }); toast('Caption saved'); }
    if (evSel) { await api(`/admin/gallery/${evSel.dataset.photoEvent}`, { method: 'PUT', body: { eventId: evSel.value } }); toast('Moved'); }
  } catch (err) { toast(err.message); }
});
$('#adminBody').addEventListener('click', async (e) => {
  if (state.tab !== 'gallery') return;
  const del = e.target.closest('[data-photo-delete]');
  if (!del || !confirm('Delete this photo from the gallery?')) return;
  try {
    await api(`/admin/gallery/${del.dataset.photoDelete}`, { method: 'DELETE', body: {} });
    state.photos = state.photos.filter((p) => p.id !== del.dataset.photoDelete);
    renderGallery();
    toast('Photo deleted');
  } catch (err) { toast(err.message); }
});

// ======================= about & contact =======================
async function loadSite() {
  state.site = (await api('/site')).site;
  renderSite();
}

function teamRow(m = {}) {
  return `<div class="team-row">
    <label class="mem-photo" title="Add a photo">${m.photo ? `<img src="${esc(m.photo)}" alt="" />` : icon('camera')}<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-team-photo /></label>
    <input data-k="name" placeholder="Name" value="${esc(m.name || '')}" maxlength="80" />
    <input data-k="role" placeholder="Role, e.g. President" value="${esc(m.role || '')}" maxlength="80" />
    <button type="button" class="icon-btn" data-team-remove aria-label="Remove">${icon('x')}</button>
    <textarea data-k="bio" rows="2" placeholder="Short bio (optional)" maxlength="400">${esc(m.bio || '')}</textarea>
    <input type="hidden" data-k="photo" value="${esc(m.photo || '')}" />
  </div>`;
}

function renderSite() {
  const s = state.site;
  $('#adminBody').innerHTML = `
    <form class="form-card" id="siteForm" novalidate>
      <div class="form-section">
        <h3>Home page</h3>
        <p class="field-hint" style="margin:0">The starting text is a placeholder. Replace it with your club’s own words.</p>
        <label class="field"><span>Headline</span><input name="heroTitle" maxlength="120" value="${esc(s.heroTitle)}" /></label>
        <label class="field"><span>Intro</span><textarea name="heroText" rows="3" maxlength="600">${esc(s.heroText)}</textarea></label>
      </div>
      <div class="form-section">
        <h3>About page</h3>
        <label class="field"><span>Mission <small>(one line, shown as the About page title and in the footer)</small></span><input name="mission" maxlength="300" value="${esc(s.mission)}" /></label>
        <label class="field"><span>About the club <small>(leave a blank line between paragraphs)</small></span><textarea name="about" rows="9" maxlength="8000">${esc(s.about)}</textarea></label>
        <label class="field"><span>When you meet <small>(optional)</small></span><input name="meeting" maxlength="300" value="${esc(s.meeting)}" placeholder="e.g. Thursdays at 7 PM, Houston Hall" /></label>
      </div>
      <div class="form-section">
        <h3>Contact</h3>
        <div class="grid-2">
          <label class="field"><span>Club email</span><input name="email" type="email" maxlength="200" value="${esc(s.email)}" /></label>
          <label class="field"><span>Instagram</span><input name="instagram" maxlength="200" value="${esc(s.instagram)}" placeholder="@handle or link" /></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Email list sign-up link</span><input name="mailingList" type="url" maxlength="300" value="${esc(s.mailingList)}" placeholder="https://" /></label>
          <label class="field"><span>Executive board application link</span><input name="boardForm" type="url" maxlength="300" value="${esc(s.boardForm)}" placeholder="https://" /></label>
        </div>
      </div>
      <div class="form-section">
        <div class="row-between"><h3>Team</h3><button type="button" class="btn btn-outline btn-small" id="addMember">${icon('plus')}Add person</button></div>
        <div class="team-editor" id="teamEditor">${(s.team || []).map(teamRow).join('')}</div>
      </div>
      <p class="form-error" id="siteError" hidden></p>
      <div class="form-actions"><small>Changes show on the site right away.</small><button class="btn btn-primary" type="submit">Save</button></div>
    </form>`;

  const form = $('#siteForm');
  $('#addMember').onclick = () => $('#teamEditor').insertAdjacentHTML('beforeend', teamRow());
  $('#teamEditor').addEventListener('click', (e) => { if (e.target.closest('[data-team-remove]')) e.target.closest('.team-row').remove(); });
  $('#teamEditor').addEventListener('change', async (e) => {
    const input = e.target.closest('[data-team-photo]');
    if (!input?.files[0]) return;
    const row = input.closest('.team-row');
    try {
      const url = await uploadPhoto(input.files[0], 600);
      $('[data-k="photo"]', row).value = url;
      $('.mem-photo', row).innerHTML = `<img src="${esc(url)}" alt="" /><input type="file" accept="image/jpeg,image/png,image/webp" hidden data-team-photo />`;
    } catch (err) { toast(err.message); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(['heroTitle', 'heroText', 'mission', 'about', 'meeting', 'email', 'instagram', 'mailingList', 'boardForm'].map((k) => [k, form[k].value]));
    body.team = $$('.team-row', form).map((r) => Object.fromEntries($$('[data-k]', r).map((i) => [i.dataset.k, i.value])));
    try {
      state.site = (await api('/admin/site', { method: 'PUT', body })).site;
      renderSite();
      toast('Saved');
    } catch (err) {
      $('#siteError').textContent = err.message;
      $('#siteError').hidden = false;
    }
  });
}

// ======================= map =======================
async function renderMap() {
  await refreshCounts();
  const m = state.summary?.map || { spaces: 0, edits: 0, reports: 0 };
  $('#adminBody').innerHTML = `
    <div class="map-summary">
      <div class="stat"><strong>${m.spaces}</strong><small>new spaces to review</small></div>
      <div class="stat"><strong>${m.edits}</strong><small>suggested edits</small></div>
      <div class="stat"><strong>${m.reports}</strong><small>problem reports</small></div>
    </div>
    <div class="aside-card">
      <p style="margin:0">Map moderation happens on the map itself, so you can see each place in context. People and admin access are managed there too, under <strong>People</strong>.</p>
      <a class="btn btn-primary" style="justify-self:start" href="/map?moderate">${icon('shield')}Open map moderation</a>
    </div>`;
}

onUserChange(boot);
boot(await initSite('admin'));
hydrateIcons();
