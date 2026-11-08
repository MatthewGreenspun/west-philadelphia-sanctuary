// The whole API: accounts, the third spaces map, moderation, uploads, plus the club routes in club.js.
// Runs as one Cloud Function behind Firebase Hosting (/api/** and /uploads/**).
import {
  initDb, newId, nowIso, bucket, SPACE_DEFAULTS,
  users, spaces, reviews, busy, reports, edits, userNames,
} from './db.js';
import { startSession, destroySession, setSuspended, currentUser, publicUser, clientIp } from './auth.js';
import { fail, isAdmin, requireVerified, requireAdmin, requireAppCheck, limit, str, send, readJson, HOUR, PHOTO_RE } from './http.js';
import { handleClubPublic, handleClubAdmin, CLUB_ADMIN_RESOURCES } from './club.js';
import { inRegion, REGION } from '../public/region.js';

const CATEGORIES = ['cafe', 'library', 'park', 'bookstore', 'community', 'market', 'bar', 'museum', 'plaza', 'coworking', 'other'];
const AMENITIES = ['wifi', 'outlets', 'restrooms', 'accessible', 'free', 'outdoor', 'food', 'kids', 'dogs', 'groups', 'laptops'];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const EDITABLE = ['name', 'category', 'description', 'address', 'neighborhood', 'website', 'lat', 'lng', 'cost', 'noise', 'amenities', 'tags', 'hours', 'photos'];

// ---------- validation ----------
function cleanSpace(input, existing = {}) {
  const out = {};
  const errors = [];

  out.name = str(input.name ?? existing.name, 120);
  if (!out.name) errors.push('Name is required');

  out.category = CATEGORIES.includes(input.category) ? input.category : existing.category || 'other';
  out.description = str(input.description ?? existing.description, 3000);
  out.address = str(input.address ?? existing.address, 200);
  out.neighborhood = str(input.neighborhood ?? existing.neighborhood, 80);
  out.website = str(input.website ?? existing.website, 300);
  if (out.website && !/^https?:\/\//i.test(out.website)) out.website = 'https://' + out.website;
  if (out.website && !/^https?:\/\/[^\s<>"']+$/i.test(out.website)) errors.push('Website must be a valid link');

  const lat = Number(input.lat ?? existing.lat);
  const lng = Number(input.lng ?? existing.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    errors.push('A valid location is required');
  } else if (!inRegion(lng, lat)) {
    errors.push(`This map only covers ${REGION.name} — that location is outside the area`);
  }
  out.lat = lat;
  out.lng = lng;

  const cost = Number(input.cost ?? existing.cost ?? 0);
  out.cost = Math.max(0, Math.min(3, Math.round(cost) || 0));
  out.noise = ['quiet', 'moderate', 'lively'].includes(input.noise) ? input.noise : existing.noise || 'moderate';

  const amen = Array.isArray(input.amenities) ? input.amenities : existing.amenities || [];
  out.amenities = [...new Set(amen.filter((a) => AMENITIES.includes(a)))];

  const tags = Array.isArray(input.tags) ? input.tags : existing.tags || [];
  out.tags = [...new Set(tags.map((t) => str(t, 30).toLowerCase()).filter(Boolean))].slice(0, 12);

  const hoursIn = input.hours ?? existing.hours ?? {};
  out.hours = {};
  for (const d of DAYS) {
    const h = str(hoursIn[d], 20);
    out.hours[d] = /^(closed|24h|\d{2}:\d{2}-\d{2}:\d{2})?$/.test(h) ? h : '';
  }

  const photos = Array.isArray(input.photos) ? input.photos : existing.photos || [];
  out.photos = photos.filter((p) => typeof p === 'string' && PHOTO_RE.test(p)).slice(0, 12);

  return { space: out, errors };
}

// ---------- permissions ----------
const canSee = (s, user) =>
  s.status === 'approved' || isAdmin(user) || (user && s.createdBy === user.id && s.status === 'pending');
// Admins edit directly. Creators can keep editing their own space until it's approved.
// Everyone else's edits become suggestions for a moderator.
const canEditDirect = (s, user) => isAdmin(user) || (user && s.createdBy === user.id && s.status === 'pending');

// Shape spaces for the browser: ratings, live busyness and (for moderators) queue counts.
async function publicSpaces(list, viewer) {
  const names = await userNames(list.map((s) => s.createdBy));
  const since = new Date(Date.now() - 2 * HOUR).toISOString();
  return list.map((s) => {
    const { createdBy, reviews: revs = [], busy: busyList = [], openReports = 0, pendingEdits = 0, ...rest } = s;
    const recent = busyList.filter((b) => b.at >= since);
    const ratings = revs.map((r) => r.rating);
    const out = {
      ...SPACE_DEFAULTS,
      ...rest,
      addedBy: names.get(createdBy) || null,
      mine: Boolean(viewer && createdBy === viewer.id),
      canEdit: Boolean(canEditDirect(s, viewer)),
      reviews: revs.map(({ userId, ...r }) => ({ ...r, mine: Boolean(viewer && userId === viewer.id) })),
      rating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
      reviewCount: ratings.length,
      busyNow: recent.length
        ? { level: Math.round(recent.reduce((a, b) => a + b.level, 0) / recent.length), reports: recent.length, at: recent[recent.length - 1].at }
        : null,
    };
    if (isAdmin(viewer)) {
      out.openReports = openReports;
      out.pendingEditCount = pendingEdits;
    }
    return out;
  });
}
const publicSpace = async (s, viewer) => (await publicSpaces([s], viewer))[0];
const pickEditable = (s) => Object.fromEntries(EDITABLE.map((k) => [k, s[k]]));

// ---------- auth routes ----------
// Signing up, signing in, password resets and email verification happen in the browser with
// Firebase Auth. These routes turn a fresh sign-in into a session cookie and back.
async function handleAuth(req, res, action) {
  if (action === 'me' && req.method === 'GET') {
    return send(res, 200, { user: publicUser(await currentUser(req)) });
  }

  if (action === 'session' && req.method === 'POST') {
    await limit(`session:${clientIp(req)}`, 30, 15 * 60 * 1000, 'Too many sign-in attempts — wait a few minutes and try again');
    const body = await readJson(req);
    const { user, created } = await startSession(req, res, body.idToken, str(body.name, 40));
    if (created && user.role === 'admin') console.log(`Admin account created: ${user.email}`);
    return send(res, created ? 201 : 200, { user: publicUser(user), created });
  }

  if (action === 'logout' && req.method === 'POST') {
    destroySession(req, res);
    return send(res, 200, { ok: true });
  }

  throw fail(404, 'Not found');
}

// ---------- space routes ----------
async function handleSpaces(req, res, id, sub, subId) {
  const viewer = await currentUser(req);

  if (!id) {
    if (req.method === 'GET') return send(res, 200, await publicSpaces(await spaces.visibleTo(viewer), viewer));
    if (req.method === 'POST') {
      const user = await requireVerified(req);
      if (!isAdmin(user)) await limit(`create:${user.id}`, 10, 24 * HOUR, "You've added a lot of spaces today — try again tomorrow");
      const { space, errors } = cleanSpace(await readJson(req));
      if (errors.length) throw fail(400, errors.join('. '));
      const now = nowIso();
      const full = { id: newId(), ...space, status: isAdmin(user) ? 'approved' : 'pending', createdBy: user.id, createdAt: now, updatedAt: now };
      await spaces.insert(full);
      return send(res, 201, { space: await publicSpace(await spaces.byId(full.id), user), pending: full.status === 'pending' });
    }
    throw fail(405, 'Method not allowed');
  }

  const space = await spaces.byId(id);
  if (!space || !canSee(space, viewer)) throw fail(404, 'Space not found');

  if (!sub && req.method === 'GET') return send(res, 200, await publicSpace(space, viewer));

  if (!sub && req.method === 'PUT') {
    const user = await requireVerified(req);
    await limit(`edit:${user.id}`, 30, HOUR);
    const { space: updates, errors } = cleanSpace(await readJson(req), space);
    if (errors.length) throw fail(400, errors.join('. '));
    if (canEditDirect(space, user)) {
      await spaces.update(space.id, updates);
      return send(res, 200, { space: await publicSpace(await spaces.byId(space.id), user), suggested: false });
    }
    await edits.submit(space.id, user.id, updates);
    return send(res, 202, { space: await publicSpace(space, user), suggested: true });
  }

  if (sub === 'reviews' && !subId && req.method === 'POST') {
    const user = await requireVerified(req);
    await limit(`review:${user.id}`, 20, HOUR);
    const body = await readJson(req);
    const rating = Math.round(Number(body.rating));
    if (!(rating >= 1 && rating <= 5)) throw fail(400, 'Rating must be 1–5');
    const created = await reviews.upsert(space.id, user, rating, str(body.text, 1500));
    return send(res, created ? 201 : 200, await publicSpace(await spaces.byId(space.id), user));
  }

  if (sub === 'reviews' && subId && req.method === 'DELETE') {
    const user = await requireVerified(req);
    const result = await reviews.remove(space.id, subId, (r) => r.userId === user.id || isAdmin(user));
    if (result === 'missing') throw fail(404, 'Review not found');
    if (result === 'forbidden') throw fail(403, 'You can only delete your own review');
    return send(res, 200, await publicSpace(await spaces.byId(space.id), user));
  }

  if (sub === 'busy' && req.method === 'POST') {
    // Open to everyone, but one report per space every 20 minutes per person/network.
    const who = viewer ? `u:${viewer.id}` : `ip:${clientIp(req)}`;
    await limit(`busy:${who}:${space.id}`, 1, 20 * 60 * 1000, 'You already reported this recently — thanks!');
    await limit(`busy:${who}`, 30, HOUR);
    const level = Math.round(Number((await readJson(req)).level));
    if (!(level >= 1 && level <= 3)) throw fail(400, 'Level must be 1–3');
    await busy.add(space.id, level);
    return send(res, 201, await publicSpace(await spaces.byId(space.id), viewer));
  }

  if (sub === 'report' && req.method === 'POST') {
    const user = await requireVerified(req);
    await limit(`report:${user.id}`, 20, 24 * HOUR);
    const body = await readJson(req);
    await reports.add(space.id, user.id, str(body.reason, 40), str(body.note, 500));
    return send(res, 201, { ok: true });
  }

  throw fail(404, 'Not found');
}

// ---------- moderation routes ----------
async function handleAdmin(req, res, parts) {
  if (CLUB_ADMIN_RESOURCES.has(parts[0])) return handleClubAdmin(req, res, parts);
  const admin = await requireAdmin(req);
  const [resource, id, sub, subId] = parts;

  if (resource === 'queue' && req.method === 'GET') {
    const [pending, editList, reportList, removed] = await Promise.all([
      spaces.byStatus('pending'), edits.all(), reports.open(), spaces.byStatus('removed', 'rejected'),
    ]);
    const related = new Map();
    for (const sid of new Set([...editList.map((e) => e.spaceId), ...reportList.map((r) => r.spaceId)])) {
      related.set(sid, await spaces.byId(sid));
    }
    const names = await userNames([...pending.map((s) => s.createdBy), ...editList.map((e) => e.userId), ...reportList.map((r) => r.userId)]);
    const shaped = await publicSpaces(pending, admin);
    return send(res, 200, {
      pendingSpaces: shaped.map((s, i) => ({ ...s, submittedBy: names.get(pending[i].createdBy) || null })),
      edits: editList.filter((e) => related.get(e.spaceId)).map((e) => {
        const s = related.get(e.spaceId);
        return { id: e.id, spaceId: s.id, spaceName: s.name, by: names.get(e.userId) || null, at: e.at, current: pickEditable(s), changes: e.changes };
      }),
      reports: reportList.filter((r) => related.get(r.spaceId)).map((r) => {
        const s = related.get(r.spaceId);
        return { id: r.id, spaceId: r.spaceId, spaceName: s.name, spaceStatus: s.status, reason: r.reason, note: r.note, by: names.get(r.userId) || null, at: r.at };
      }),
      removed: removed.map((s) => ({ id: s.id, name: s.name, status: s.status, updatedAt: s.updatedAt })),
    });
  }

  if (resource === 'spaces' && id) {
    const space = await spaces.byId(id);
    if (!space) throw fail(404, 'Space not found');

    if (!sub && req.method === 'POST') {
      const { status } = await readJson(req);
      if (!['approved', 'rejected', 'removed'].includes(status)) throw fail(400, 'Unknown status');
      await spaces.setStatus(space.id, status);
      return send(res, 200, await publicSpace(await spaces.byId(space.id), admin));
    }

    if (sub === 'edits' && subId && req.method === 'POST') {
      const { action } = await readJson(req);
      const edit = await edits.byId(subId);
      if (!edit || edit.spaceId !== space.id) throw fail(404, 'Suggestion not found');
      if (action !== 'approve' && action !== 'reject') throw fail(400, 'Unknown action');
      let updates = null;
      if (action === 'approve') {
        const cleaned = cleanSpace(edit.changes, space);
        if (cleaned.errors.length) throw fail(400, cleaned.errors.join('. '));
        updates = cleaned.space;
      }
      await edits.resolve(edit, updates);
      return send(res, 200, await publicSpace(await spaces.byId(space.id), admin));
    }

    if (sub === 'reports' && subId && req.method === 'POST') {
      const report = await reports.byId(subId);
      if (!report || report.spaceId !== space.id) throw fail(404, 'Report not found');
      const { action } = await readJson(req);
      if (!['resolved', 'dismissed'].includes(action)) throw fail(400, 'Unknown action');
      await reports.setStatus(subId, action);
      return send(res, 200, { ok: true });
    }
  }

  if (resource === 'users' && !id && req.method === 'GET') return send(res, 200, await users.listWithCounts());

  if (resource === 'users' && id && req.method === 'POST') {
    const user = await users.byId(id);
    if (!user) throw fail(404, 'User not found');
    if (user.id === admin.id) throw fail(400, "You can't change your own account here");
    const body = await readJson(req);
    if (typeof body.banned === 'boolean') await setSuspended(user.id, body.banned);
    if (body.role === 'admin' || body.role === 'user') await users.setRole(user.id, body.role);
    return send(res, 200, { ok: true });
  }

  throw fail(404, 'Not found');
}

// ---------- uploads (stored in Cloud Storage, served at /uploads/<name>) ----------
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

async function handleUpload(req, res) {
  const user = await requireVerified(req);
  await limit(`upload:${user.id}`, 60, HOUR, 'Upload limit reached — try again in a bit');
  const { dataUrl } = await readJson(req);
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw fail(400, 'Expected a JPEG, PNG or WebP image');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const name = `${Date.now()}-${newId()}.${ext}`;
  await bucket().file(`uploads/${name}`).save(Buffer.from(m[2], 'base64'), {
    contentType: TYPES[ext], resumable: false, metadata: { cacheControl: 'public, max-age=31536000, immutable' },
  });
  return send(res, 201, { url: `/uploads/${name}` });
}

async function serveUpload(req, res, name) {
  if (!/^[\w-]+\.(jpg|png|webp)$/.test(name)) return send(res, 404, 'Not found');
  try {
    const [buf] = await bucket().file(`uploads/${name}`).download();
    res.writeHead(200, {
      'Content-Type': TYPES[name.split('.').pop()],
      // Photo names never change, so Firebase Hosting's CDN can cache them for a year.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(buf);
  } catch {
    send(res, 404, 'Not found');
  }
}

// ---------- router ----------
async function handleApi(req, res, url) {
  // Every write must be JSON. Browsers can't send cross-site JSON without CORS approval,
  // which (with SameSite cookies) blocks cross-site request forgery.
  if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw fail(415, 'Expected JSON');
  }
  if (req.method !== 'GET') await requireAppCheck(req);
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const [resource, ...rest] = parts;
  if (resource === 'auth') return handleAuth(req, res, rest[0]);
  if (resource === 'spaces') return handleSpaces(req, res, ...rest);
  if (resource === 'admin') return handleAdmin(req, res, rest);
  if (resource === 'uploads' && req.method === 'POST') return handleUpload(req, res);
  if (['site', 'events', 'calendar.ics', 'gallery', 'volunteers'].includes(resource)) return handleClubPublic(req, res, resource, rest);
  throw fail(404, 'Not found');
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    await initDb();
    if (url.pathname.startsWith('/uploads/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return await serveUpload(req, res, decodeURIComponent(url.pathname.slice('/uploads/'.length)));
    }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return send(res, 404, 'Not found');
  } catch (err) {
    if (!err.status) console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
  }
}
