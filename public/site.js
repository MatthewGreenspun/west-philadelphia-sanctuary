// Shared by every page: header + nav, sign-in, footer, and small helpers.
import { icon } from './config.js';
import { loadFirebase, appCheckToken, authMessage } from './firebase.js';

// ---------- helpers ----------
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const hydrateIcons = (root = document) => $$('[data-icon]', root).forEach((el) => (el.innerHTML = icon(el.dataset.icon)));

export const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem('tsp:' + key)) ?? fallback; } catch { return fallback; } },
  set(key, val) { try { localStorage.setItem('tsp:' + key, JSON.stringify(val)); } catch { /* storage unavailable */ } },
};

export async function api(path, { method = 'GET', body } = {}) {
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  // Every change carries an App Check token proving it came from this site.
  if (method !== 'GET') {
    try {
      const token = await appCheckToken();
      if (token) headers['X-Firebase-AppCheck'] = token;
    } catch { /* the server will explain what went wrong */ }
  }
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session.user && !path.startsWith('/auth/')) setUser(null); // session expired or suspended
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

let toastTimer;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

export function relTime(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Shrink photos in the browser before uploading.
export async function resizeImage(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}
export async function uploadPhoto(file, max) {
  const dataUrl = await resizeImage(file, max);
  return (await api('/uploads', { method: 'POST', body: { dataUrl } })).url;
}

// ---------- event dates ----------
// Event times are Philadelphia local time strings ("2026-11-20T18:00"). Parsing them as UTC and
// formatting in UTC shows exactly those numbers, whatever time zone the visitor is in.
export const localDate = (s) => new Date(s + ':00Z');
const fmt = (s, opts) => localDate(s).toLocaleString('en-US', { timeZone: 'UTC', ...opts });
export const fmtDay = (s) => fmt(s, { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtLongDay = (s) => fmt(s, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const fmtTime = (s) => fmt(s, { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
export function fmtTimeRange(e) {
  if (!e.endsAt) return fmtTime(e.startsAt);
  const sameDay = e.endsAt.slice(0, 10) === e.startsAt.slice(0, 10);
  if (!sameDay) return `${fmtTime(e.startsAt)} – ${fmtDay(e.endsAt)}, ${fmtTime(e.endsAt)}`;
  const a = fmtTime(e.startsAt);
  const b = fmtTime(e.endsAt);
  // "6 – 8 PM" rather than "6 PM – 8 PM" when both are in the afternoon (or both morning).
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}
export const fmtWhen = (e) => `${fmtDay(e.startsAt)} · ${fmtTimeRange(e)}`;
export const where = (e) => e.space?.name || e.location || e.address || '';

export function dateBadge(e) {
  const d = localDate(e.startsAt);
  const m = d.toLocaleString('en-US', { timeZone: 'UTC', month: 'short' });
  return `<span class="date-badge"><small>${m}</small><strong>${d.getUTCDate()}</strong></span>`;
}

// Short label for sign-up state, e.g. "12 going · 3 spots left".
export function signupSummary(e) {
  if (e.signupMode === 'none') return '';
  const parts = [];
  if (e.counts.going) parts.push(`${e.counts.going} going`);
  if (e.counts.interested) parts.push(`${e.counts.interested} interested`);
  if (e.capacity && !e.past) parts.push(e.spotsLeft ? `${e.spotsLeft} spot${e.spotsLeft === 1 ? '' : 's'} left` : 'Full — waitlist open');
  return parts.join(' · ');
}

export function eventCard(e, { compact = false } = {}) {
  const cover = e.cover
    ? `<img src="${esc(e.cover)}" alt="" loading="lazy" />`
    : `<span class="event-cover-ph">${icon('calendar')}</span>`;
  const summary = signupSummary(e);
  return `<a class="event-card${compact ? ' compact' : ''}${e.past ? ' past' : ''}" href="/events?event=${esc(e.id)}">
    <div class="event-cover">${cover}${dateBadge(e)}</div>
    <div class="event-body">
      <span class="event-when">${esc(fmtWhen(e))}</span>
      <h3>${esc(e.title)}${e.published ? '' : ' <span class="pill-pending">Draft</span>'}</h3>
      ${where(e) ? `<span class="event-where">${icon('pin')}${esc(where(e))}</span>` : ''}
      ${!compact && e.summary ? `<p>${esc(e.summary)}</p>` : ''}
      ${summary ? `<span class="event-count">${esc(summary)}</span>` : ''}
    </div>
  </a>`;
}

// ---------- site info ----------
let sitePromise;
export const getSite = () => (sitePromise ||= api('/site').catch(() => ({ site: {}, stats: {} })));

// ---------- session ----------
export const session = { user: null };
const userListeners = [];
export const onUserChange = (fn) => userListeners.push(fn);
export const isAdmin = () => session.user?.role === 'admin';

function setUser(user) {
  session.user = user;
  renderAuthUI();
  for (const fn of userListeners) fn(user);
}

// ---------- header ----------
const NAV = [
  { id: 'home', href: '/', label: 'Home' },
  { id: 'about', href: '/about', label: 'About' },
  { id: 'events', href: '/events', label: 'Events' },
  { id: 'gallery', href: '/gallery', label: 'Gallery' },
  { id: 'map', href: '/map', label: 'Third spaces' },
];

function headerHtml(page) {
  const links = NAV.map((n) => `<a href="${n.href}"${n.id === page ? ' aria-current="page"' : ''}>${n.label}</a>`).join('');
  return `
    <a class="brand" href="/" aria-label="West Philadelphia Sanctuary home">
      <img class="brand-logo" src="/logo.jpg" alt="" width="44" height="44" />
      <span class="brand-text"><span class="brand-small">West Philadelphia</span><span class="brand-name">Sanctuary</span></span>
    </a>
    <nav class="site-nav" id="siteNav" aria-label="Main">
      ${links}
      <a class="nav-cta${page === 'volunteer' ? ' active' : ''}" href="/volunteer"${page === 'volunteer' ? ' aria-current="page"' : ''}>Volunteer</a>
    </nav>
    <div class="header-actions">
      <button class="btn btn-outline btn-small" id="signInBtn">Sign in</button>
      <div class="user-menu" id="userMenu" hidden>
        <button class="avatar-btn" id="avatarBtn" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">
          <span class="avatar" id="avatar"></span><span class="badge mod-badge" id="adminBadge" hidden></span>
        </button>
        <div class="menu" id="menu" role="menu" hidden>
          <div class="menu-head"><strong id="menuName"></strong><small id="menuRole"></small></div>
          <div id="menuExtra"></div>
          <button role="menuitem" id="menuVerify" hidden>${icon('mail')}Verify your email</button>
          <a role="menuitem" href="/admin" id="menuAdmin" hidden>${icon('grid')}Club admin<span class="badge" id="menuAdminCount" hidden></span></a>
          <button role="menuitem" id="menuSignOut">${icon('logout')}Sign out</button>
        </div>
      </div>
      <button class="icon-btn nav-toggle" id="navToggle" aria-label="Menu" aria-expanded="false" aria-controls="siteNav">${icon('menu')}</button>
    </div>`;
}

const AUTH_DIALOG = `
  <dialog id="authDialog" class="dialog dialog-sm">
    <form id="authForm" method="dialog" novalidate>
      <header class="dialog-head">
        <h2 id="authTitle">Sign in</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
      </header>
      <div class="dialog-body">
        <p class="auth-reason" id="authReason" hidden></p>
        <button type="button" class="btn btn-outline btn-block google-btn" id="googleBtn"><svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>Continue with Google</button>
        <div class="auth-divider"><span>or use email</span></div>
        <div class="segmented auth-tabs" id="authTabs">
          <button type="button" data-value="login">Sign in</button><button type="button" data-value="register">Create account</button>
        </div>
        <label class="field" id="nameField"><span>Name</span><input name="name" autocomplete="name" maxlength="40" placeholder="Shown on your reviews" /></label>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required /></label>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" minlength="8" required /></label>
        <p class="field-hint" id="pwHint" hidden>At least 8 characters. We'll email you a link to confirm your address.</p>
        <button type="button" class="link-btn" id="forgotBtn">Forgot password?</button>
        <p class="auth-note" id="authNote" hidden></p>
        <p class="form-error" id="authError" hidden></p>
      </div>
      <footer class="dialog-foot">
        <button type="submit" class="btn btn-primary btn-block" id="authSubmit">Sign in</button>
      </footer>
    </form>
  </dialog>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>`;

// Close any dialog by clicking its backdrop or a [data-close] button.
export function wireDialog(d) {
  if (d.dataset.wired) return;
  d.dataset.wired = '1';
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
}

// ---------- sign in ----------
let afterAuth = null;
let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  const f = $('#authForm');
  $$('#authTabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === mode)));
  $('#authTitle').textContent = mode === 'login' ? 'Sign in' : 'Create an account';
  $('#authSubmit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  $('#nameField').hidden = mode === 'login';
  $('#pwHint').hidden = mode === 'login';
  $('#forgotBtn').hidden = mode !== 'login';
  $('#authNote').hidden = true;
  f.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#authError').hidden = true;
}

export function openAuth(reason = '', then = null, mode = 'login') {
  afterAuth = then;
  $('#authForm').reset();
  $('#authReason').textContent = reason;
  $('#authReason').hidden = !reason;
  setAuthMode(mode);
  $('#authDialog').showModal();
  $('#authForm').email.focus();
}

export function requireAuth(reason, then) {
  if (session.user) then();
  else openAuth(reason, then);
}

// Last step of every sign-in: swap the Firebase sign-in for a session cookie from our server.
async function finishSignIn({ auth, authMod }, cred, name, { isNew = false, sentLink = false } = {}) {
  const idToken = await cred.user.getIdToken();
  const { user, created } = await api('/auth/session', { method: 'POST', body: { idToken, name } });
  authMod.signOut(auth).catch(() => {});
  const next = afterAuth;
  afterAuth = null;
  $('#authDialog').close();
  setUser(user);
  const verifyMsg = sentLink ? ' Check your email for a link to verify your address.' : '';
  toast(isNew || created
    ? `Welcome, ${user.name}${user.role === 'admin' ? ' — you’re an admin' : ''}!${verifyMsg}`
    : `Signed in as ${user.name}.${verifyMsg}`);
  if (next) next();
}

function wireAuth() {
  $('#googleBtn').addEventListener('click', async () => {
    const err = $('#authError');
    err.hidden = true;
    $('#googleBtn').disabled = true;
    try {
      const fb = await loadFirebase();
      const cred = await fb.authMod.signInWithPopup(fb.auth, new fb.authMod.GoogleAuthProvider());
      await finishSignIn(fb, cred, cred.user.displayName || '');
    } catch (ex) {
      if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(ex.code)) {
        err.textContent = ex.code ? authMessage(ex) : ex.message;
        err.hidden = false;
      }
    } finally {
      $('#googleBtn').disabled = false;
    }
  });

  $('#authTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setAuthMode(b.dataset.value); });
  $('#signInBtn').addEventListener('click', () => openAuth());
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('#authError');
    const showError = (msg) => { err.textContent = msg; err.hidden = false; };
    const email = f.email.value.trim();
    const password = f.password.value;
    const name = f.name.value.trim();
    err.hidden = true;
    if (authMode === 'register' && !name) return showError('Please enter your name');
    if (authMode === 'register' && password.length < 8) return showError('Password must be at least 8 characters');
    $('#authSubmit').disabled = true;
    try {
      // 1. Sign in (or sign up) with Firebase Auth in the browser.
      const { auth, authMod } = await loadFirebase();
      let cred;
      let sentLink = false;
      if (authMode === 'register') {
        cred = await authMod.createUserWithEmailAndPassword(auth, email, password);
        await authMod.updateProfile(cred.user, { displayName: name });
        sentLink = await authMod.sendEmailVerification(cred.user).then(() => true, () => false);
      } else {
        cred = await authMod.signInWithEmailAndPassword(auth, email, password);
        if (!cred.user.emailVerified) sentLink = await authMod.sendEmailVerification(cred.user).then(() => true, () => false);
      }
      // 2. Swap it for a session cookie from our server.
      await finishSignIn({ auth, authMod }, cred, name, { isNew: authMode === 'register', sentLink });
    } catch (ex) {
      showError(ex.code ? authMessage(ex) : ex.message);
    } finally {
      $('#authSubmit').disabled = false;
    }
  });

  $('#forgotBtn').addEventListener('click', async () => {
    const email = $('#authForm').email.value.trim();
    const err = $('#authError');
    err.hidden = true;
    if (!email) { err.textContent = 'Enter your email above, then tap “Forgot password?” again'; err.hidden = false; return; }
    try {
      const { auth, authMod } = await loadFirebase();
      await authMod.sendPasswordResetEmail(auth, email);
    } catch (ex) {
      // Don't reveal whether an account exists; only report real problems.
      if (!['auth/user-not-found', 'auth/invalid-email'].includes(ex.code)) {
        err.textContent = authMessage(ex);
        err.hidden = false;
        return;
      }
    }
    $('#authNote').textContent = `If there’s an account for ${email}, we sent it a link to reset the password.`;
    $('#authNote').hidden = false;
  });
  $('#menuVerify').addEventListener('click', () => openAuth('Sign in again and we’ll email you a new verification link.'));
  $('#authDialog').addEventListener('close', () => { afterAuth = null; });

  const menu = $('#menu');
  $('#avatarBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    $('#avatarBtn').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.user-menu')) menu.hidden = true; });
  menu.addEventListener('click', () => { menu.hidden = true; });
  $('#menuSignOut').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* signed out locally anyway */ }
    setUser(null);
    toast('Signed out');
  });

  const nav = $('#siteNav');
  $('#navToggle').addEventListener('click', () => {
    const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    $('#navToggle').setAttribute('aria-expanded', String(open));
  });
}

function renderAuthUI() {
  const u = session.user;
  $('#signInBtn').hidden = Boolean(u);
  $('#userMenu').hidden = !u;
  if (!u) return;
  $('#avatar').textContent = u.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  $('#menuName').textContent = u.name;
  $('#menuRole').textContent = u.role === 'admin' ? 'Admin' : 'Member';
  $('#menuAdmin').hidden = u.role !== 'admin';
  $('#menuVerify').hidden = u.emailVerified;
  $$('#menuExtra [data-admin-only]').forEach((b) => (b.hidden = u.role !== 'admin'));
  refreshAdminCount();
}

// Pages can add their own items to the account menu.
export function addMenuItem({ id, iconName, label, onClick, adminOnly = false }) {
  const b = document.createElement('button');
  b.setAttribute('role', 'menuitem');
  b.id = id;
  if (adminOnly) { b.dataset.adminOnly = '1'; b.hidden = !isAdmin(); }
  b.innerHTML = `${icon(iconName)}${esc(label)}<span class="badge" hidden></span>`;
  b.addEventListener('click', onClick);
  $('#menuExtra').append(b);
  return b;
}

// Badge on the avatar: new volunteers + map items waiting for review.
export async function refreshAdminCount() {
  if (!isAdmin()) return null;
  let s;
  try { s = await api('/admin/summary'); } catch { return null; }
  const total = s.newVolunteers + s.map.spaces + s.map.edits + s.map.reports;
  for (const el of [$('#adminBadge'), $('#menuAdminCount')]) { el.hidden = !total; el.textContent = total; }
  return s;
}

// ---------- footer ----------
async function renderFooter() {
  const el = $('#siteFooter');
  if (!el) return;
  const { site } = await getSite();
  const handle = (site.instagram || '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '@').replace(/\/$/, '');
  const contact = [
    site.instagram ? `<a href="${esc(site.instagram)}" target="_blank" rel="noopener">${icon('instagram')}${esc(handle)}</a>` : '',
    site.email ? `<a href="mailto:${esc(site.email)}">${icon('mail')}${esc(site.email)}</a>` : '',
    site.mailingList ? `<a href="${esc(site.mailingList)}" target="_blank" rel="noopener">${icon('arrowRight')}Join our email list</a>` : '',
  ].join('');
  el.innerHTML = `
    <div class="footer-inner">
      <div class="footer-brand">
        <img class="brand-logo" src="/logo.jpg" alt="" width="56" height="56" loading="lazy" />
        <div><strong>West Philadelphia Sanctuary</strong><p>${esc(site.mission || '')}</p></div>
      </div>
      <nav class="footer-links" aria-label="Footer">
        <a href="/about">About</a><a href="/events">Events</a><a href="/gallery">Gallery</a><a href="/map">Third spaces map</a><a href="/volunteer">Volunteer</a>
      </nav>
      ${contact ? `<div class="footer-contact">${contact}</div>` : ''}
    </div>
    <p class="footer-fine">Est. 2023 · Penn P4P Award winner · Always free, always open to everyone. Map data © OpenStreetMap contributors.</p>`;
}

// ---------- boot ----------
// Every page calls this first. Returns the signed-in user (or null).
export async function initSite(page) {
  const header = $('#siteHeader');
  header.className = 'site-header';
  header.innerHTML = headerHtml(page);
  document.body.insertAdjacentHTML('beforeend', AUTH_DIALOG);
  wireDialog($('#authDialog'));
  wireAuth();
  hydrateIcons();
  renderFooter();
  try {
    session.user = (await api('/auth/me')).user;
  } catch { /* treat as signed out */ }
  renderAuthUI();
  return session.user;
}
