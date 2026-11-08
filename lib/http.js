// Small helpers shared by all API routes.
import { getAppCheck } from 'firebase-admin/app-check';
import { currentUser } from './auth.js';
import { rateLimit } from './db.js';

// Running locally in the Firebase emulators (App Check can't run there).
export const IN_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';

const MAX_BODY = 10 * 1024 * 1024;
export const HOUR = 60 * 60 * 1000;

export const fail = (status, message) => Object.assign(new Error(message), { status });

export const isAdmin = (user) => user?.role === 'admin';

export async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) throw fail(401, 'Please sign in first');
  return user;
}

// Posting anything others will see needs a verified email.
export async function requireVerified(req) {
  const user = await requireUser(req);
  if (!user.emailVerified) {
    throw fail(403, 'Please verify your email first — click the link we sent you, or sign in again to get a new one');
  }
  return user;
}

export async function requireAdmin(req) {
  const user = await requireUser(req);
  if (!isAdmin(user)) throw fail(403, 'Admins only');
  if (!user.emailVerified) throw fail(403, 'Verify your email before using admin tools — check your inbox');
  return user;
}

// App Check: every change must come from our own site, not a script.
export async function requireAppCheck(req) {
  if (IN_EMULATOR) return;
  const token = req.headers['x-firebase-appcheck'];
  if (!token) throw fail(403, 'This request didn\u2019t come from the site. Refresh the page and try again.');
  try {
    await getAppCheck().verifyToken(String(token));
  } catch {
    throw fail(403, 'We couldn\u2019t verify this request. Refresh the page and try again.');
  }
}

export async function limit(key, max, windowMs, message = 'Too many requests — please slow down and try again later') {
  if (!(await rateLimit(key, max, windowMs))) throw fail(429, message);
}

// Trimmed string, or '' if it isn't one.
export const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Uploaded photos are served from /uploads/<name>.
export const PHOTO_RE = /^\/uploads\/[\w-]+\.(jpg|jpeg|png|webp)$/;

export function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'private, no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

export async function readJson(req) {
  // Cloud Functions has already read the body into req.rawBody.
  let buf = req.rawBody;
  if (!buf) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw fail(413, 'Payload too large');
      chunks.push(chunk);
    }
    buf = Buffer.concat(chunks);
  }
  if (buf.length > MAX_BODY) throw fail(413, 'Payload too large');
  try {
    return JSON.parse(buf.toString('utf8') || '{}');
  } catch {
    throw fail(400, 'Invalid JSON');
  }
}

// CSV download. Cells that start with = + - @ get a leading ' so spreadsheet apps don't run them as formulas.
export function sendCsv(res, filename, header, rows) {
  const cell = (v) => {
    let s = Array.isArray(v) ? v.join('; ') : String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  });
  res.end('﻿' + body); // BOM so Excel reads UTF-8 names correctly
}
