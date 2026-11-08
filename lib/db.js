// Firestore data layer. Only the server (Cloud Function) talks to Firestore; the browser never does.
//
// Collections:
//   users (id = Firebase Auth uid), spaces (reviews + recent busyness stored on the space),
//   reports, edits (id = spaceId_userId), events (sign-up counts stored on the event),
//   eventSignups (id = eventId_emailHash), volunteers, photos, rateLimits, meta
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_FILE = path.join(ROOT, 'seed', 'spaces.json');
const SEED_VERSION = 'wps-2-spaces';

if (!getApps().length) initializeApp();
export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
export const bucket = () => getStorage().bucket();
export { FieldValue };

export const newId = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, (c) => (c === '-' ? 'x' : 'y'));
export const nowIso = () => new Date().toISOString();
export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const col = (name) => db.collection(name);
const data = (snap) => (snap.exists ? { id: snap.id, ...snap.data() } : null);
const docs = (qs) => qs.docs.map((d) => ({ id: d.id, ...d.data() }));
export const transaction = (fn) => db.runTransaction(fn);
export { col, data, docs };

// ---------- users ----------
export const users = {
  byId: async (id) => (id ? data(await col('users').doc(id).get()) : null),
  adminQuery: () => col('users').where('role', '==', 'admin').limit(1),
  hasAdmin: async () => !(await users.adminQuery().get()).empty,
  // Profile for a Firebase Auth account (id = Auth uid). Creates it on first sign-in.
  ensure: (id, { email, name }, roleFor) => transaction(async (tx) => {
    const ref = col('users').doc(id);
    const snap = await tx.get(ref);
    if (snap.exists) {
      const u = { id, ...snap.data() };
      if (email && u.email !== email) tx.update(ref, { email });
      return { ...u, email, created: false };
    }
    const u = { name: String(name || 'Member').slice(0, 40), email, role: await roleFor(tx), banned: false, createdAt: nowIso() };
    tx.set(ref, u);
    return { id, ...u, created: true };
  }),
  setRole: (id, role) => col('users').doc(id).update({ role }),
  setBanned: (id, banned) => col('users').doc(id).update({ banned }),
  async listWithCounts() {
    const [list, allSpaces] = await Promise.all([col('users').orderBy('createdAt').get().then(docs), col('spaces').get().then(docs)]);
    return list.map((u) => ({
      id: u.id, name: u.name, email: u.email, role: u.role, banned: Boolean(u.banned), createdAt: u.createdAt,
      spaces: allSpaces.filter((s) => s.createdBy === u.id).length,
      reviews: allSpaces.reduce((n, s) => n + (s.reviews || []).filter((r) => r.userId === u.id).length, 0),
    }));
  },
};

export async function userNames(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const snaps = await db.getAll(...list.map((id) => col('users').doc(id)));
  return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, s.get('name')]));
}

// ---------- spaces ----------
const SPACE_FIELDS = ['name', 'category', 'description', 'address', 'neighborhood', 'website', 'lat', 'lng', 'cost', 'noise', 'amenities', 'tags', 'hours', 'photos'];
const pickFields = (s) => Object.fromEntries(SPACE_FIELDS.map((k) => [k, s[k]]));
// Values for fields a space might not have (e.g. starter spaces have no photos).
export const SPACE_DEFAULTS = { description: '', address: '', neighborhood: '', website: '', cost: 0, noise: 'moderate', amenities: [], tags: [], hours: {}, photos: [] };

export const spaces = {
  byId: async (id) => data(await col('spaces').doc(id).get()),
  all: async () => docs(await col('spaces').get()),
  async visibleTo(viewer) {
    const list = await spaces.all();
    return list.filter((s) => s.status === 'approved'
      || (s.status === 'pending' && (viewer?.role === 'admin' || (viewer && s.createdBy === viewer.id))));
  },
  async byStatus(...statuses) {
    const list = docs(await col('spaces').where('status', 'in', statuses).get());
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  insert: (s) => {
    const { id, ...rest } = s;
    return col('spaces').doc(id).set({ reviews: [], busy: [], openReports: 0, pendingEdits: 0, ...SPACE_DEFAULTS, ...rest });
  },
  update: (id, f) => col('spaces').doc(id).update({ ...pickFields(f), updatedAt: nowIso() }),
  setStatus: (id, status) => col('spaces').doc(id).update({ status, updatedAt: nowIso() }),
};

// ---------- reviews (stored on the space) ----------
export const reviews = {
  // One review per person per space: posting again replaces the old one. Returns true if it was new.
  upsert: (spaceId, user, rating, text) => transaction(async (tx) => {
    const ref = col('spaces').doc(spaceId);
    const list = (await tx.get(ref)).get('reviews') || [];
    const i = list.findIndex((r) => r.userId === user.id);
    const review = { id: i >= 0 ? list[i].id : newId(), userId: user.id, author: user.name, rating, text, at: nowIso() };
    if (i >= 0) list[i] = review;
    else list.unshift(review);
    list.sort((a, b) => b.at.localeCompare(a.at));
    tx.update(ref, { reviews: list });
    return i < 0;
  }),
  // Removes a review if `allowed(review)` says so. Returns 'ok', 'missing' or 'forbidden'.
  remove: (spaceId, reviewId, allowed) => transaction(async (tx) => {
    const ref = col('spaces').doc(spaceId);
    const list = (await tx.get(ref)).get('reviews') || [];
    const r = list.find((x) => x.id === reviewId);
    if (!r) return 'missing';
    if (!allowed(r)) return 'forbidden';
    tx.update(ref, { reviews: list.filter((x) => x.id !== reviewId) });
    return 'ok';
  }),
};

// ---------- busyness (recent reports stored on the space, older than 2 hours dropped) ----------
export const busy = {
  add: (spaceId, level) => transaction(async (tx) => {
    const ref = col('spaces').doc(spaceId);
    const since = new Date(Date.now() - 2 * 3600e3).toISOString();
    const list = ((await tx.get(ref)).get('busy') || []).filter((b) => b.at >= since);
    list.push({ level, at: nowIso() });
    tx.update(ref, { busy: list.slice(-50) });
  }),
};

// ---------- problem reports ----------
export const reports = {
  async add(spaceId, userId, reason, note) {
    const b = db.batch();
    b.set(col('reports').doc(newId()), { spaceId, userId, reason, note, status: 'open', at: nowIso() });
    b.update(col('spaces').doc(spaceId), { openReports: FieldValue.increment(1) });
    await b.commit();
  },
  byId: async (id) => data(await col('reports').doc(id).get()),
  setStatus: (id, status) => transaction(async (tx) => {
    const ref = col('reports').doc(id);
    const r = data(await tx.get(ref));
    if (!r) return;
    tx.update(ref, { status });
    if (r.status === 'open' && status !== 'open') tx.update(col('spaces').doc(r.spaceId), { openReports: FieldValue.increment(-1) });
  }),
  open: async () => docs(await col('reports').where('status', '==', 'open').get()).sort((a, b) => b.at.localeCompare(a.at)),
};

// ---------- suggested edits ----------
export const edits = {
  // Replaces any earlier suggestion from the same person for the same space.
  submit: (spaceId, userId, changes) => transaction(async (tx) => {
    const ref = col('edits').doc(`${spaceId}_${userId}`);
    const existed = (await tx.get(ref)).exists;
    tx.set(ref, { spaceId, userId, changes, at: nowIso() });
    if (!existed) tx.update(col('spaces').doc(spaceId), { pendingEdits: FieldValue.increment(1) });
  }),
  byId: async (id) => data(await col('edits').doc(id).get()),
  // Deletes the suggestion, optionally applying `updates` to the space in the same transaction.
  resolve: (edit, updates) => transaction(async (tx) => {
    const spaceRef = col('spaces').doc(edit.spaceId);
    if (updates) tx.update(spaceRef, { ...pickFields(updates), updatedAt: nowIso() });
    tx.update(spaceRef, { pendingEdits: FieldValue.increment(-1) });
    tx.delete(col('edits').doc(edit.id));
  }),
  all: async () => docs(await col('edits').get()).sort((a, b) => a.at.localeCompare(b.at)),
};

// ---------- rate limits (shared across all server instances) ----------
export async function rateLimit(key, max, windowMs) {
  const ref = col('rateLimits').doc(sha(key).slice(0, 40));
  return transaction(async (tx) => {
    const now = Date.now();
    const hits = ((await tx.get(ref)).get('hits') || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) return false;
    hits.push(now);
    // expireAt lets an optional Firestore TTL policy clean up old docs.
    tx.set(ref, { hits: hits.slice(-200), expireAt: new Date(now + Math.max(windowMs, 86400e3)) });
    return true;
  });
}

// ---------- first run: starter spaces ----------
// When the starter list changes: drop old starter spaces that aren't in it, add new ones,
// and refresh starter spaces nobody has edited yet. Spaces people added are never touched.
async function refreshSeed() {
  const metaRef = col('meta').doc('seed');
  if ((await metaRef.get()).get('version') === SEED_VERSION) return;
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const ids = new Set(seed.map((s) => s.id));
  const existing = new Map((await spaces.all()).map((s) => [s.id, s]));
  const now = nowIso();
  const b = db.batch();
  for (const s of existing.values()) if (!s.createdBy && !ids.has(s.id)) b.delete(col('spaces').doc(s.id));
  for (const s of seed) {
    const cur = existing.get(s.id);
    const { id, ...fields } = s;
    if (!cur) b.set(col('spaces').doc(id), { reviews: [], busy: [], openReports: 0, pendingEdits: 0, ...SPACE_DEFAULTS, ...pickFields(fields), status: 'approved', createdBy: null, createdAt: now, updatedAt: now });
    else if (!cur.createdBy && cur.updatedAt === cur.createdAt) b.update(col('spaces').doc(id), pickFields({ ...cur, ...fields }));
  }
  b.set(metaRef, { version: SEED_VERSION });
  await b.commit();
}

let ready;
export const initDb = () => (ready ||= refreshSeed().catch((err) => { ready = null; throw err; }));
