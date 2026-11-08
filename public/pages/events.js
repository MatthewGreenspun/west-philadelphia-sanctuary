import {
  $, $$, esc, api, toast, store, initSite, session, onUserChange, hydrateIcons, wireDialog, isAdmin,
  eventCard, fmtLongDay, fmtTimeRange, fmtTime, localDate, signupSummary, where,
} from '../site.js';
import { icon } from '../config.js';

await initSite('events');

const state = {
  events: [],
  view: store.get('eventsView', 'list'),
  month: null, // "YYYY-MM" shown in calendar view
  openId: null,
};
const mySignups = () => store.get('signups', {});
const saveSignup = (eventId, s) => { const all = mySignups(); if (s) all[eventId] = s; else delete all[eventId]; store.set('signups', all); };

// Today's date in Philadelphia, "YYYY-MM-DD".
const phillyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

async function load() {
  try {
    state.events = await api('/events');
  } catch {
    $('#upcomingView').innerHTML = '<div class="empty-card"><p>Couldn’t load events right now. Try refreshing.</p></div>';
    return;
  }
  render();
}

// ---------- list + calendar ----------
function render() {
  const upcoming = state.events.filter((e) => !e.past);
  const past = state.events.filter((e) => e.past).reverse();
  $$('#viewSwitch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));

  if (state.view === 'calendar') renderCalendar();
  else if (!upcoming.length) {
    $('#upcomingView').innerHTML = `<div class="empty-card">${icon('calendar')}<strong>Nothing on the calendar right now</strong><p>New events are posted here first${past.length ? ' — in the meantime, see what we’ve done before below' : ''}.</p></div>`;
  } else {
    const groups = new Map();
    for (const e of upcoming) {
      const key = localDate(e.startsAt).toLocaleString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    $('#upcomingView').innerHTML = [...groups].map(([month, list]) => `
      <div class="month-group"><h3>${esc(month)}</h3><div class="event-grid">${list.map((e) => eventCard(e)).join('')}</div></div>`).join('');
  }

  $('#pastSection').hidden = !past.length;
  $('#pastList').innerHTML = past.slice(0, 12).map((e) => eventCard(e, { compact: true })).join('');
  hydrateIcons($('main'));
}

function renderCalendar() {
  const today = phillyToday();
  if (!state.month) {
    const next = state.events.find((e) => !e.past);
    state.month = (next && next.startsAt.slice(0, 7) > today.slice(0, 7) && !state.events.some((e) => e.startsAt.slice(0, 7) === today.slice(0, 7)))
      ? next.startsAt.slice(0, 7)
      : today.slice(0, 7);
  }
  const [y, m] = state.month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay()); // back up to Sunday
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((first.getUTCDay() + daysInMonth) / 7) * 7;

  const byDay = new Map();
  for (const e of state.events) {
    const d = e.startsAt.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(e);
  }

  let html = '';
  for (let i = 0; i < cells; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const evs = byDay.get(key) || [];
    const cls = ['cal-day', d.getUTCMonth() !== m - 1 ? 'other' : '', key === today ? 'today' : ''].filter(Boolean).join(' ');
    html += `<div class="${cls}"><span class="cal-num">${d.getUTCDate()}</span>${evs.map((e) =>
      `<a class="cal-event${e.past ? ' past' : ''}" href="/events?event=${esc(e.id)}" data-event="${esc(e.id)}" title="${esc(e.title)}"><time>${esc(fmtTime(e.startsAt))}</time>${esc(e.title)}</a>`).join('')}</div>`;
  }
  const label = first.toLocaleString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  $('#upcomingView').innerHTML = `
    <div class="calendar">
      <div class="cal-head">
        <h3>${esc(label)}</h3>
        <div class="cal-nav">
          <button class="btn btn-ghost btn-small" data-month="today">Today</button>
          <button class="icon-btn" data-month="-1" aria-label="Previous month">${icon('chevronLeft')}</button>
          <button class="icon-btn" data-month="1" aria-label="Next month">${icon('chevronRight')}</button>
        </div>
      </div>
      <div class="cal-grid">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}${html}</div>
    </div>`;
}

$('#viewSwitch').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.view = b.dataset.view;
  store.set('eventsView', state.view);
  render();
});

$('#upcomingView').addEventListener('click', (e) => {
  const nav = e.target.closest('[data-month]');
  if (nav) {
    if (nav.dataset.month === 'today') state.month = phillyToday().slice(0, 7);
    else {
      const [y, m] = state.month.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + Number(nav.dataset.month), 1));
      state.month = d.toISOString().slice(0, 7);
    }
    renderCalendar();
  }
});

// Open event links in the dialog instead of reloading the page.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/events?event="]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  openEvent(new URL(a.href).searchParams.get('event'));
});

// ---------- event detail ----------
const dialog = $('#eventDialog');
wireDialog(dialog);
dialog.addEventListener('close', () => {
  state.openId = null;
  const url = new URL(location.href);
  url.searchParams.delete('event');
  history.replaceState(null, '', url);
  document.title = 'Events · West Philadelphia Sanctuary';
});

function openEvent(id, { push = true } = {}) {
  const e = state.events.find((x) => x.id === id);
  if (!e) return toast('That event couldn’t be found');
  state.openId = id;
  renderEvent();
  if (!dialog.open) dialog.showModal();
  $('.ev-scroll', dialog).scrollTop = 0;
  if (push) {
    const url = new URL(location.href);
    url.searchParams.set('event', id);
    history.replaceState(null, '', url);
  }
  document.title = `${e.title} · Events`;
}

const gcalTime = (s) => s.replace(/[-:]/g, '') + '00';
function googleLink(e) {
  const end = e.endsAt || new Date(localDate(e.startsAt).getTime() + 3 * 3600e3).toISOString().slice(0, 16);
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${gcalTime(e.startsAt)}/${gcalTime(end)}`,
    ctz: 'America/New_York',
    details: `${e.summary || ''}\n\n${location.origin}/events?event=${e.id}`.trim(),
    location: [e.space?.name || e.location, e.address || e.space?.address].filter(Boolean).join(', '),
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

const STATUS_TEXT = { going: 'You’re going', interested: 'You’re interested', waitlist: 'You’re on the waitlist' };

function signupHtml(e) {
  if (e.signupMode === 'none') return '';
  if (e.past) return '';
  const mine = mySignups()[e.id];
  if (mine) {
    return `<div class="signup-box"><div class="signed-up">
      <div><span class="tick">${icon('check')}</span><div><strong>${STATUS_TEXT[mine.status] || 'You’re signed up'}</strong><small>as ${esc(mine.name)} (${esc(mine.email)})</small></div></div>
      <div class="row"><button class="btn btn-ghost btn-small" data-act="change">Change</button><button class="btn btn-danger btn-small" data-act="cancel">Cancel</button></div>
    </div>${mine.status === 'waitlist' ? '<p class="field-hint" style="margin:0">The event is full right now. We’ll reach out by email if a spot opens up.</p>' : ''}</div>`;
  }
  const full = e.capacity && !e.spotsLeft;
  const choice = e.signupMode === 'rsvp'
    ? `<div class="signup-choice">
        <label><input type="radio" name="status" value="going" checked /><span>${full ? 'Join the waitlist' : 'I’m going'}<small>${full ? 'It’s full — we’ll email if a spot opens' : e.spotsLeft ? `${e.spotsLeft} spot${e.spotsLeft === 1 ? '' : 's'} left` : 'Save me a spot'}</small></span></label>
        <label><input type="radio" name="status" value="interested" /><span>I’m interested<small>Keep me posted</small></span></label>
      </div>`
    : '<p class="field-hint" style="margin:0">Let us know you’re interested and we’ll follow up with details.</p>';
  const prev = store.get('signupContact', {});
  return `<form class="signup-box" id="signupForm" novalidate>
    <h3>${e.signupMode === 'rsvp' ? 'RSVP' : 'I’m interested'}</h3>
    ${choice}
    <div class="grid-2">
      <label class="field"><span>Name</span><input name="name" required maxlength="100" autocomplete="name" value="${esc(prev.name || session.user?.name || '')}" /></label>
      <label class="field"><span>Email</span><input name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(prev.email || '')}" /></label>
    </div>
    <label class="field"><span>Anything we should know? <small>(optional)</small></span><textarea name="note" rows="2" maxlength="500" placeholder="Accessibility needs, questions, bringing a friend…"></textarea></label>
    <label class="hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off" /></label>
    <p class="form-error" id="signupError" hidden></p>
    <div class="row-between"><small class="muted">We only use your email for this event.</small><button class="btn btn-primary" type="submit">${e.signupMode === 'rsvp' ? 'Sign up' : 'Count me in'}</button></div>
  </form>`;
}

function renderEvent() {
  const e = state.events.find((x) => x.id === state.openId);
  if (!e) return dialog.close();
  const place = e.space?.name || e.location;
  const address = e.address || e.space?.address || '';
  const summary = signupSummary(e);
  $('#eventBody').innerHTML = `
    <div class="ev-scroll">
      <div class="ev-hero">${e.cover ? `<img src="${esc(e.cover)}" alt="" />` : `<span class="event-cover-ph">${icon('calendar')}</span>`}
        <button class="icon-btn ev-close" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="ev-content">
        <div>
          ${e.past ? '<p class="eyebrow" style="color:var(--muted)">Past event</p>' : ''}
          <h2>${esc(e.title)}${e.published ? '' : ' <span class="pill-pending">Draft</span>'}</h2>
          ${e.summary ? `<p class="muted" style="margin:6px 0 0">${esc(e.summary)}</p>` : ''}
        </div>
        <div class="ev-facts">
          <div class="ev-fact">${icon('calendar')}<div>${esc(fmtLongDay(e.startsAt))}<small>${esc(fmtTimeRange(e))}</small></div></div>
          ${place || address ? `<div class="ev-fact">${icon('pin')}<div>${esc(place || address)}${place && address ? `<small>${esc(address)}</small>` : ''}
            ${e.space ? `<small><a href="/map?space=${esc(e.space.id)}">See it on the third spaces map</a></small>` : ''}</div></div>` : ''}
          ${summary ? `<div class="ev-fact">${icon('users')}<div>${esc(summary)}</div></div>` : ''}
          ${e.link ? `<div class="ev-fact">${icon('external')}<div><a href="${esc(e.link)}" target="_blank" rel="noopener">More info</a></div></div>` : ''}
        </div>
        ${e.past ? '' : `<div class="ev-tools">
          <a class="btn btn-outline btn-small" href="${esc(googleLink(e))}" target="_blank" rel="noopener">${icon('calendar')}Google Calendar</a>
          <a class="btn btn-outline btn-small" href="/api/events/${esc(e.id)}/calendar.ics">${icon('download')}Apple / Outlook (.ics)</a>
          <button class="btn btn-outline btn-small" data-act="share">${icon('share')}Share</button>
        </div>`}
        ${e.description ? `<p class="ev-desc">${esc(e.description)}</p>` : ''}
        ${e.past && e.photoCount ? `<a class="more-link" href="/gallery#event-${esc(e.id)}">See ${e.photoCount} photo${e.photoCount === 1 ? '' : 's'} from this event ${icon('arrowRight')}</a>` : ''}
        ${signupHtml(e)}
        ${isAdmin() ? `<a class="btn btn-ghost btn-small" style="justify-self:start;margin-bottom:16px" href="/admin?tab=events&event=${esc(e.id)}">${icon('edit')}Edit or see sign-ups</a>` : ''}
      </div>
    </div>`;
  bindEvent(e);
}

function bindEvent(e) {
  const form = $('#signupForm');
  form?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#signupError');
    const body = {
      name: form.name.value, email: form.email.value, note: form.note.value, website: form.website.value,
      status: form.status?.value || 'interested',
    };
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    try {
      const res = await api(`/events/${e.id}/signups`, { method: 'POST', body });
      saveSignup(e.id, res.signup);
      store.set('signupContact', { name: res.signup.name, email: res.signup.email });
      replaceEvent(res.event);
      toast(res.signup.status === 'waitlist' ? 'You’re on the waitlist' : res.signup.status === 'going' ? 'You’re going — see you there!' : 'Thanks — we’ll keep you posted');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });

  $('#eventBody').onclick = async (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'share') {
      const url = `${location.origin}/events?event=${e.id}`;
      if (navigator.share) { try { await navigator.share({ title: e.title, url }); } catch { /* dismissed */ } return; }
      try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link', url); }
    }
    if (act === 'change') {
      saveSignup(e.id, null);
      renderEvent();
      toast('Update your details and sign up again');
    }
    if (act === 'cancel') {
      const mine = mySignups()[e.id];
      if (!confirm('Cancel your sign-up for this event?')) return;
      try {
        const res = await api(`/events/${e.id}/signups/${mine.id}`, { method: 'DELETE', body: { token: mine.token } });
        saveSignup(e.id, null);
        replaceEvent(res.event);
        toast('Your sign-up was cancelled');
      } catch (ex) {
        // Already removed (e.g. by an organizer): forget it locally.
        saveSignup(e.id, null);
        renderEvent();
        toast(ex.message);
      }
    }
  };
}

function replaceEvent(updated) {
  const i = state.events.findIndex((x) => x.id === updated.id);
  if (i >= 0) state.events[i] = updated;
  render();
  if (state.openId === updated.id) renderEvent();
}

onUserChange(() => load());

await load();
const linked = new URLSearchParams(location.search).get('event');
if (linked) openEvent(linked, { push: false });
