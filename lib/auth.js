// Sign-in uses Firebase Auth. The browser signs in with Firebase, sends us the ID token once,
// and we swap it for a Firebase session cookie. Profiles (name, role, suspended) live in Firestore.
import { getAuth } from 'firebase-admin/auth';
import { users } from './db.js';

// Firebase Hosting only passes a cookie named "__session" through to Cloud Functions.
const COOKIE = '__session';
const SESSION_MS = 14 * 86400 * 1000; // the longest Firebase allows
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const authError = (status, message) => Object.assign(new Error(message), { status });

// Admins: anyone listed in ADMIN_EMAILS (once they've verified that email). If that's not set,
// the first account created becomes the admin so a fresh install can be moderated.
// Runs inside the sign-up transaction so two simultaneous first sign-ups can't both become admin.
const roleForNewUser = async (tx) => {
  if (ADMIN_EMAILS.length) return 'user';
  return (await tx.get(users.adminQuery())).empty ? 'admin' : 'user';
};

async function syncAdminRole(user) {
  if (user.emailVerified && ADMIN_EMAILS.includes(user.email) && user.role !== 'admin') {
    await users.setRole(user.id, 'admin');
    user.role = 'admin';
  }
}

// Called right after the browser signs in (or creates an account) with Firebase.
export async function startSession(req, res, idToken, name) {
  const auth = getAuth();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(String(idToken || ''), true);
  } catch {
    throw authError(401, 'Sign-in failed — please try again');
  }
  // Only accept a fresh sign-in, so a leaked old token can't be turned into a session.
  if (Date.now() / 1000 - decoded.auth_time > 5 * 60) throw authError(401, 'Please sign in again');
  const record = await auth.getUser(decoded.uid);
  if (record.disabled) throw authError(403, 'This account has been suspended');
  const email = (record.email || '').toLowerCase();
  const profile = await users.ensure(decoded.uid, { email, name: name || record.displayName || email.split('@')[0] }, roleForNewUser);
  if (profile.banned) throw authError(403, 'This account has been suspended');
  const cookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_MS });
  setCookie(res, req, cookie, SESSION_MS / 1000);
  const user = { ...profile, email, emailVerified: record.emailVerified };
  await syncAdminRole(user);
  return { user, created: profile.created };
}

export function destroySession(req, res) {
  setCookie(res, req, '', 0);
}

// Suspends or restores an account everywhere: Firestore profile, Firebase Auth, existing sessions.
export async function setSuspended(userId, banned) {
  await users.setBanned(userId, banned);
  try {
    await getAuth().updateUser(userId, { disabled: banned });
    if (banned) await getAuth().revokeRefreshTokens(userId);
  } catch { /* account may not exist in Auth (e.g. deleted there) */ }
}

// Looked up once per request and remembered on the request object.
export async function currentUser(req) {
  if (req._user !== undefined) return req._user;
  req._user = null;
  const cookie = readCookie(req);
  if (!cookie) return null;
  try {
    const auth = getAuth();
    const decoded = await auth.verifySessionCookie(cookie);
    // Fresh account details: suspended, signed out everywhere, email verified since sign-in.
    const record = await auth.getUser(decoded.uid);
    const revokedAt = record.tokensValidAfterTime ? Date.parse(record.tokensValidAfterTime) : 0;
    if (record.disabled || decoded.auth_time * 1000 < revokedAt - 1000) return null;
    const profile = await users.byId(decoded.uid);
    if (!profile || profile.banned) return null;
    const user = { ...profile, email: (record.email || '').toLowerCase(), emailVerified: record.emailVerified };
    await syncAdminRole(user);
    req._user = user;
  } catch { /* expired or invalid cookie: signed out */ }
  return req._user;
}

function readCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setCookie(res, req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted;
  const parts = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAge)}`];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// What the browser is allowed to know about a user.
export const publicUser = (u) => (u ? { id: u.id, name: u.name, role: u.role, emailVerified: Boolean(u.emailVerified) } : null);

// Visitor's IP, for rate limits. Behind Firebase Hosting the first X-Forwarded-For entry is the visitor.
export function clientIp(req) {
  const fwd = String(req.headers['fastly-client-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || 'unknown';
}
