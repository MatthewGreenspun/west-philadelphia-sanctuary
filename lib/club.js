// Club website data and API: site text, events + sign-ups, volunteer intake, photo gallery.
import crypto from 'node:crypto';
import { col, data, docs, db, transaction, newId, nowIso, sha, FieldValue } from './db.js';
import { currentUser, clientIp } from './auth.js';
import { fail, isAdmin, requireAdmin, limit, str, send, readJson, sendCsv, EMAIL_RE, HOUR, PHOTO_RE } from './http.js';

const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const TZ = 'America/New_York';

// Current Philadelphia time in the same "YYYY-MM-DDTHH:MM" format events use.
export function phillyNow(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// Local-time string plus hours, without caring about time zones (both sides are Philly local time).
function addHours(local, h) {
  const d = new Date(local + ':00Z');
  d.setUTCHours(d.getUTCHours() + h);
  return d.toISOString().slice(0, 16);
}
// Events without an end time count as 3 hours long.
const endOf = (e) => e.endsAt || addHours(e.startsAt, 3);

function url(v, max = 300) {
  let s = str(v, max);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  if (!/^https?:\/\/[^\s<>"']+$/i.test(s)) throw fail(400, 'Links must be valid web addresses');
  return s;
}

const count = async (query) => (await query.count().get()).data().count;

// ===================== site text =====================
// Everything here is editable from the admin page. The defaults are placeholders for the club to replace.
export const SITE_DEFAULTS = {
  heroTitle: 'Find community in West Philly.',
  heroText: 'We\u2019re creating a third space for community, care, and connection in West Philadelphia. Come to our free pop-ups to make art, play games, sing, write, and spend time with your neighbors. Always free, always open to everyone.',
  mission: 'A space for community, care and collaboration in West Philadelphia.',
  about: [
    'West Philadelphia Sanctuary (WPS) is a physical space for all people of the West Philadelphia community to gain respite and engage with one another.',
    'We aim to reduce stigma and loneliness, and to create a generative space where people of all backgrounds can connect. Our free pop-ups have included clay art, jewelry making, writing workshops, singing lessons, T-shirt making, ceramic tile painting and board game nights.',
    'We also team up with groups around Penn and West Philly, like ALLin for our Wellness Festival at The Rotunda and Active Minds Penn, to support mental health and community health in the neighborhood.',
    'Founded in 2023 and a Penn P4P Award winner, WPS is always free and always open to everyone.',
  ].join('\n\n'),
  meeting: 'Pop-ups are usually Monday evenings, 7\u20138:30 PM, at The Rotunda (4014 Walnut St). Follow our Instagram for the latest.',
  email: 'westphillysanctuary@gmail.com',
  instagram: 'https://www.instagram.com/westphillysanctuary/',
  mailingList: 'https://docs.google.com/forms/d/e/1FAIpQLSe30SYKPB-OWka9nJLTXYYTCE7htn9pidjiz0OyqBxBYQLX9w/viewform',
  boardForm: 'https://docs.google.com/forms/d/e/1FAIpQLSfbJQAFikdkOk7owuhGlJxMHhzSuG9yVS1j1Jb3pzZS7buQMQ/viewform',
  team: [],
};
const siteRef = () => col('meta').doc('site');

async function getSite() {
  const stored = (await siteRef().get()).data() || {};
  const out = structuredClone(SITE_DEFAULTS);
  for (const k of Object.keys(out)) if (k in stored) out[k] = stored[k];
  return out;
}

function cleanSite(input) {
  const out = {};
  const text = { heroTitle: 120, heroText: 600, mission: 300, about: 8000, meeting: 300 };
  for (const [k, max] of Object.entries(text)) if (k in input) out[k] = str(input[k], max);
  if ('email' in input) {
    out.email = str(input.email, 200);
    if (out.email && !EMAIL_RE.test(out.email)) throw fail(400, 'Contact email is not valid');
  }
  if ('instagram' in input) {
    const ig = str(input.instagram, 200).replace(/^@/, '');
    out.instagram = !ig ? '' : /^[\w.]+$/.test(ig) ? `https://www.instagram.com/${ig}/` : url(ig);
  }
  for (const k of ['mailingList', 'boardForm']) if (k in input) out[k] = url(input[k]);
  if ('team' in input) {
    if (!Array.isArray(input.team)) throw fail(400, 'Team must be a list');
    out.team = input.team.slice(0, 40).map((m) => ({
      name: str(m?.name, 80),
      role: str(m?.role, 80),
      bio: str(m?.bio, 400),
      photo: PHOTO_RE.test(m?.photo || '') ? m.photo : '',
    })).filter((m) => m.name);
  }
  return out;
}

// ===================== events =====================
const SIGNUP_MODES = ['rsvp', 'interest', 'none'];
const ZERO = { going: 0, interested: 0, waitlist: 0 };

const events = {
  byId: async (id) => (id ? data(await col('events').doc(id).get()) : null),
  async list(includeDrafts) {
    const list = docs(await col('events').get());
    return list.filter((e) => includeDrafts || e.published).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  },
};

async function publicEvents(rows, viewer) {
  const spaceIds = [...new Set(rows.map((e) => e.spaceId).filter(Boolean))];
  const spaceSnaps = spaceIds.length ? await db.getAll(...spaceIds.map((id) => col('spaces').doc(id))) : [];
  const spaceMap = new Map(spaceSnaps.filter((s) => s.exists && s.get('status') === 'approved')
    .map((s) => [s.id, { id: s.id, name: s.get('name'), address: s.get('address'), lat: s.get('lat'), lng: s.get('lng') }]));
  const now = phillyNow();
  return rows.map((e) => {
    const c = { ...ZERO, ...e.counts };
    const out = {
      id: e.id,
      title: e.title,
      summary: e.summary,
      description: e.description,
      startsAt: e.startsAt,
      endsAt: e.endsAt || null,
      location: e.location,
      address: e.address,
      space: spaceMap.get(e.spaceId) || null,
      cover: e.cover,
      signupMode: e.signupMode,
      capacity: e.capacity || null,
      link: e.link,
      published: Boolean(e.published),
      past: endOf(e) < now,
      counts: c,
      spotsLeft: e.capacity ? Math.max(0, e.capacity - c.going) : null,
      photoCount: e.photoCount || 0,
    };
    if (isAdmin(viewer)) out.spaceId = e.spaceId || null;
    return out;
  });
}
const publicEvent = async (id, viewer) => (await publicEvents([await events.byId(id)], viewer))[0];

async function cleanEvent(input) {
  const e = {};
  e.title = str(input.title, 140);
  if (!e.title) throw fail(400, 'Title is required');
  e.summary = str(input.summary, 240);
  e.description = str(input.description, 6000);
  e.startsAt = str(input.startsAt, 16);
  if (!TIME_RE.test(e.startsAt) || Number.isNaN(Date.parse(e.startsAt + ':00Z'))) throw fail(400, 'Start date and time are required');
  e.endsAt = str(input.endsAt, 16) || null;
  if (e.endsAt && (!TIME_RE.test(e.endsAt) || e.endsAt <= e.startsAt)) throw fail(400, 'End time must be after the start');
  e.location = str(input.location, 160);
  e.address = str(input.address, 200);
  e.spaceId = str(input.spaceId, 40) || null;
  if (e.spaceId) {
    const s = (await col('spaces').doc(e.spaceId).get());
    if (!s.exists || s.get('status') !== 'approved') throw fail(400, 'That third space no longer exists');
  }
  e.cover = PHOTO_RE.test(input.cover || '') ? input.cover : '';
  e.signupMode = SIGNUP_MODES.includes(input.signupMode) ? input.signupMode : 'rsvp';
  const cap = Math.round(Number(input.capacity));
  e.capacity = cap > 0 ? Math.min(cap, 100000) : null;
  e.link = url(input.link);
  e.published = input.published !== false;
  return e;
}

// One sign-up per email per event, so the id comes from both.
const signupId = (eventId, email) => `${eventId}_${sha(email).slice(0, 20)}`;
const signupsFor = async (eventId) => docs(await col('eventSignups').where('eventId', '==', eventId).get())
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

// Changes one sign-up's status (or removes it with status = null), keeping the event's counts in step.
function moveSignup(tx, eventRef, eventDoc, signupRef, from, to, fields = {}) {
  const counts = { ...ZERO, ...eventDoc.counts };
  if (from) counts[from] = Math.max(0, counts[from] - 1);
  if (to) counts[to] += 1;
  tx.update(eventRef, { counts });
  if (to) tx.set(signupRef, { ...fields, status: to, updatedAt: nowIso() }, { merge: true });
  else tx.delete(signupRef);
}

// ===================== calendar files (.ics) =====================
const NY_TIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:America/New_York',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];
const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTime = (local) => local.replace(/[-:]/g, '') + '00';
// Lines longer than 75 bytes must be folded.
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function siteOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${proto}://${String(host).split(',')[0].trim()}`;
}

function sendIcs(res, req, rows, filename, calName) {
  const origin = siteOrigin(req);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//West Philadelphia Sanctuary//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(calName)}`, 'X-WR-TIMEZONE:America/New_York', ...NY_TIMEZONE];
  for (const e of rows) {
    const where = [e.location, e.address].filter(Boolean).join(', ');
    const link = `${origin}/events?event=${e.id}`;
    lines.push('BEGIN:VEVENT', `UID:${e.id}@wpsc-events`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=America/New_York:${icsTime(e.startsAt)}`, `DTEND;TZID=America/New_York:${icsTime(endOf(e))}`,
      `SUMMARY:${icsText(e.title)}`, `DESCRIPTION:${icsText([e.summary || e.description, link].filter(Boolean).join('\n\n'))}`,
      ...(where ? [`LOCATION:${icsText(where)}`] : []), `URL:${link}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  res.writeHead(200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Cache-Control': 'public, max-age=300',
  });
  res.end(lines.map(fold).join('\r\n') + '\r\n');
}

// ===================== volunteers =====================
export const VOLUNTEER_OPTIONS = {
  affiliation: ['penn-undergrad', 'penn-grad', 'penn-staff', 'other-student', 'neighbor', 'other'],
  interests: ['events', 'outreach', 'mapping', 'social', 'photo', 'welcome', 'fundraising', 'other'],
  availability: ['weekday-morning', 'weekday-afternoon', 'weekday-evening', 'weekend-morning', 'weekend-afternoon', 'weekend-evening'],
  status: ['new', 'contacted', 'active', 'archived'],
};

function cleanVolunteer(input) {
  const v = {};
  v.name = str(input.name, 100);
  if (!v.name) throw fail(400, 'Please enter your name');
  v.email = str(input.email, 200).toLowerCase();
  if (!EMAIL_RE.test(v.email)) throw fail(400, 'Please enter a valid email');
  v.phone = str(input.phone, 40);
  v.affiliation = VOLUNTEER_OPTIONS.affiliation.includes(input.affiliation) ? input.affiliation : '';
  v.school = str(input.school, 120);
  const pick = (list, allowed) => [...new Set((Array.isArray(list) ? list : []).filter((x) => allowed.includes(x)))];
  v.interests = pick(input.interests, VOLUNTEER_OPTIONS.interests);
  if (!v.interests.length) throw fail(400, 'Pick at least one way you\u2019d like to help');
  v.availability = pick(input.availability, VOLUNTEER_OPTIONS.availability);
  v.howHeard = str(input.howHeard, 200);
  v.message = str(input.message, 2000);
  return v;
}
const allVolunteers = async () => docs(await col('volunteers').orderBy('createdAt', 'desc').get());

// ===================== gallery =====================
async function galleryPhotos() {
  const [photos, evs] = await Promise.all([docs(await col('photos').get()), events.list(true)]);
  const byId = new Map(evs.map((e) => [e.id, e]));
  const sortKey = (p) => byId.get(p.eventId)?.startsAt || p.createdAt.slice(0, 16);
  return photos
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || a.createdAt.localeCompare(b.createdAt))
    .map((p) => {
      const e = byId.get(p.eventId);
      return {
        id: p.id, url: p.url, caption: p.caption, createdAt: p.createdAt,
        event: e && e.published ? { id: e.id, title: e.title, startsAt: e.startsAt } : null,
        eventId: e ? e.id : null,
      };
    });
}

// ===================== public routes =====================
// /api/site, /api/events..., /api/calendar.ics, /api/volunteers, /api/gallery
export async function handleClubPublic(req, res, resource, rest) {
  const viewer = await currentUser(req);
  const ip = clientIp(req);

  if (resource === 'site' && req.method === 'GET') {
    const now = phillyNow();
    const [site, evs, spaceCount, photoCount] = await Promise.all([
      getSite(), events.list(false), count(col('spaces').where('status', '==', 'approved')), count(col('photos')),
    ]);
    return send(res, 200, { site, stats: { spaces: spaceCount, upcomingEvents: evs.filter((e) => endOf(e) >= now).length, photos: photoCount } });
  }

  if (resource === 'calendar.ics' && req.method === 'GET') {
    const since = addHours(phillyNow(), -24 * 60);
    return sendIcs(res, req, (await events.list(false)).filter((e) => e.startsAt >= since), 'events.ics', 'West Philadelphia Sanctuary');
  }

  if (resource === 'gallery' && req.method === 'GET') {
    return send(res, 200, (await galleryPhotos()).filter((p) => p.event || !p.eventId || isAdmin(viewer)));
  }

  if (resource === 'volunteers' && !rest.length && req.method === 'POST') {
    const body = await readJson(req);
    if (body.website) return send(res, 201, { ok: true }); // hidden field only bots fill in
    await limit(`volunteer:${ip}`, 5, HOUR, 'Too many forms sent from this network — try again later');
    const v = cleanVolunteer(body);
    const now = nowIso();
    await col('volunteers').doc(newId()).set({ ...v, status: 'new', notes: '', createdAt: now, updatedAt: now });
    return send(res, 201, { ok: true });
  }

  if (resource === 'events') {
    const [id, sub, subId] = rest;
    if (!id && req.method === 'GET') return send(res, 200, await publicEvents(await events.list(isAdmin(viewer)), viewer));

    const event = await events.byId(id);
    if (!event || (!event.published && !isAdmin(viewer))) throw fail(404, 'Event not found');
    const [shaped] = await publicEvents([event], viewer);

    if (!sub && req.method === 'GET') return send(res, 200, shaped);
    if (sub === 'calendar.ics' && req.method === 'GET') return sendIcs(res, req, [event], `${event.id}.ics`, event.title);

    if (sub === 'signups' && !subId && req.method === 'POST') {
      const body = await readJson(req);
      if (event.signupMode === 'none') throw fail(400, 'This event doesn\u2019t take sign-ups');
      if (shaped.past) throw fail(400, 'This event has already happened');
      if (body.website) return send(res, 201, { signup: { id: 'x', status: 'going', token: 'x' }, event: shaped });
      await limit(`signup:${ip}`, 20, HOUR, 'Too many sign-ups from this network — try again later');
      const name = str(body.name, 100);
      const email = str(body.email, 200).toLowerCase();
      if (!name) throw fail(400, 'Please enter your name');
      if (!EMAIL_RE.test(email)) throw fail(400, 'Please enter a valid email');
      const wanted = event.signupMode === 'interest' ? 'interested' : body.status === 'interested' ? 'interested' : 'going';
      const note = str(body.note, 500);
      const token = crypto.randomBytes(24).toString('base64url');
      const sid = signupId(event.id, email);
      const eventRef = col('events').doc(event.id);
      const signupRef = col('eventSignups').doc(sid);
      const status = await transaction(async (tx) => {
        const [evSnap, suSnap] = await Promise.all([tx.get(eventRef), tx.get(signupRef)]);
        if (!evSnap.exists) throw fail(404, 'Event not found');
        const ev = evSnap.data();
        const prev = suSnap.exists ? suSnap.get('status') : null;
        const counts = { ...ZERO, ...ev.counts };
        const goingOthers = counts.going - (prev === 'going' ? 1 : 0);
        const next = wanted === 'going' && ev.capacity && goingOthers >= ev.capacity ? 'waitlist' : wanted;
        moveSignup(tx, eventRef, ev, signupRef, prev, next, {
          eventId: event.id, name, email, note, tokenHash: sha(token), userId: viewer?.id ?? (suSnap.exists ? suSnap.get('userId') : null) ?? null,
          ...(suSnap.exists ? {} : { createdAt: nowIso() }),
        });
        return next;
      });
      return send(res, 201, { signup: { id: sid, status, token, name, email }, event: await publicEvent(event.id, viewer) });
    }

    if (sub === 'signups' && subId && req.method === 'DELETE') {
      const { token } = await readJson(req);
      const eventRef = col('events').doc(event.id);
      const signupRef = col('eventSignups').doc(subId);
      await transaction(async (tx) => {
        const [evSnap, suSnap] = await Promise.all([tx.get(eventRef), tx.get(signupRef)]);
        if (!suSnap.exists || suSnap.get('eventId') !== event.id) throw fail(404, 'Sign-up not found');
        const ok = isAdmin(viewer) || (typeof token === 'string' && sha(token) === suSnap.get('tokenHash'));
        if (!ok) throw fail(403, 'You can only cancel your own sign-up');
        moveSignup(tx, eventRef, evSnap.data(), signupRef, suSnap.get('status'), null);
      });
      return send(res, 200, { event: await publicEvent(event.id, viewer) });
    }
  }

  throw fail(404, 'Not found');
}

// ===================== admin routes =====================
// /api/admin/{summary, site, events, volunteers, gallery}
export const CLUB_ADMIN_RESOURCES = new Set(['summary', 'site', 'events', 'volunteers', 'volunteers.csv', 'gallery']);

export async function handleClubAdmin(req, res, parts) {
  const admin = await requireAdmin(req);
  const [resource, id, sub, subId] = parts;

  if (resource === 'summary' && req.method === 'GET') {
    const now = phillyNow();
    const [newVolunteers, evs, pendingSpaces, editCount, openReports] = await Promise.all([
      count(col('volunteers').where('status', '==', 'new')),
      events.list(true),
      count(col('spaces').where('status', '==', 'pending')),
      count(col('edits')),
      count(col('reports').where('status', '==', 'open')),
    ]);
    return send(res, 200, {
      newVolunteers,
      upcomingEvents: evs.filter((e) => endOf(e) >= now).length,
      map: { spaces: pendingSpaces, edits: editCount, reports: openReports },
    });
  }

  if (resource === 'site' && req.method === 'PUT') {
    await siteRef().set(cleanSite(await readJson(req)), { merge: true });
    return send(res, 200, { site: await getSite() });
  }

  if (resource === 'events') {
    if (!id && req.method === 'POST') {
      const e = await cleanEvent(await readJson(req));
      const newEventId = newId();
      const now = nowIso();
      await col('events').doc(newEventId).set({ ...e, counts: { ...ZERO }, photoCount: 0, createdAt: now, updatedAt: now });
      return send(res, 201, await publicEvent(newEventId, admin));
    }
    const event = await events.byId(id);
    if (!event) throw fail(404, 'Event not found');
    const eventRef = col('events').doc(event.id);

    if (!sub && req.method === 'PUT') {
      await eventRef.update({ ...(await cleanEvent(await readJson(req))), updatedAt: nowIso() });
      return send(res, 200, await publicEvent(event.id, admin));
    }
    if (!sub && req.method === 'DELETE') {
      // Sign-ups go with the event; photos stay in the gallery, no longer tied to it.
      const [signupSnaps, photoSnaps] = await Promise.all([
        col('eventSignups').where('eventId', '==', event.id).get(),
        col('photos').where('eventId', '==', event.id).get(),
      ]);
      const refs = [...signupSnaps.docs.map((d) => ['delete', d.ref]), ...photoSnaps.docs.map((d) => ['unlink', d.ref]), ['delete', eventRef]];
      for (let i = 0; i < refs.length; i += 400) {
        const b = db.batch();
        for (const [op, ref] of refs.slice(i, i + 400)) op === 'delete' ? b.delete(ref) : b.update(ref, { eventId: null });
        await b.commit();
      }
      return send(res, 200, { ok: true });
    }
    if (sub === 'signups' && !subId && req.method === 'GET') {
      return send(res, 200, (await signupsFor(event.id)).map((s) => ({ id: s.id, name: s.name, email: s.email, status: s.status, note: s.note, createdAt: s.createdAt })));
    }
    if (sub === 'signups.csv' && req.method === 'GET') {
      const slug = event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'event';
      return sendCsv(res, `${slug}-signups.csv`, ['Name', 'Email', 'Status', 'Note', 'Signed up'],
        (await signupsFor(event.id)).map((s) => [s.name, s.email, s.status, s.note, s.createdAt]));
    }
    if (sub === 'signups' && subId && (req.method === 'POST' || req.method === 'DELETE')) {
      const status = req.method === 'DELETE' ? null : (await readJson(req)).status;
      if (status !== null && !['going', 'interested', 'waitlist'].includes(status)) throw fail(400, 'Unknown status');
      const signupRef = col('eventSignups').doc(subId);
      await transaction(async (tx) => {
        const [evSnap, suSnap] = await Promise.all([tx.get(eventRef), tx.get(signupRef)]);
        if (!suSnap.exists || suSnap.get('eventId') !== event.id) throw fail(404, 'Sign-up not found');
        moveSignup(tx, eventRef, evSnap.data(), signupRef, suSnap.get('status'), status);
      });
      return send(res, 200, { ok: true });
    }
  }

  if (resource === 'volunteers' && !id && req.method === 'GET') return send(res, 200, await allVolunteers());
  if (resource === 'volunteers.csv' && req.method === 'GET') {
    return sendCsv(res, 'volunteers.csv',
      ['Name', 'Email', 'Phone', 'Affiliation', 'School / year', 'Interests', 'Availability', 'How they heard', 'Message', 'Status', 'Officer notes', 'Submitted'],
      (await allVolunteers()).map((v) => [v.name, v.email, v.phone, v.affiliation, v.school, v.interests, v.availability, v.howHeard, v.message, v.status, v.notes, v.createdAt]));
  }
  if (resource === 'volunteers' && id) {
    const ref = col('volunteers').doc(id);
    const row = data(await ref.get());
    if (!row) throw fail(404, 'Volunteer not found');
    if (req.method === 'PUT') {
      const body = await readJson(req);
      const status = VOLUNTEER_OPTIONS.status.includes(body.status) ? body.status : row.status;
      const notes = 'notes' in body ? str(body.notes, 4000) : row.notes;
      await ref.update({ status, notes, updatedAt: nowIso() });
      return send(res, 200, data(await ref.get()));
    }
    if (req.method === 'DELETE') {
      await ref.delete();
      return send(res, 200, { ok: true });
    }
  }

  if (resource === 'gallery') {
    const checkEvent = async (eid) => {
      if (!eid) return null;
      if (!(await events.byId(eid))) throw fail(400, 'That event no longer exists');
      return eid;
    };
    // Keeps each event's photo count in step when a photo is added, moved or removed.
    const bump = (b, eid, n) => { if (eid) b.update(col('events').doc(eid), { photoCount: FieldValue.increment(n) }); };

    if (!id && req.method === 'GET') return send(res, 200, await galleryPhotos());
    if (!id && req.method === 'POST') {
      const { photos } = await readJson(req);
      if (!Array.isArray(photos) || !photos.length) throw fail(400, 'No photos to add');
      const now = nowIso();
      const b = db.batch();
      for (const p of photos.slice(0, 60)) {
        if (!PHOTO_RE.test(p?.url || '')) throw fail(400, 'Upload the photos first');
        const eventId = await checkEvent(str(p.eventId, 40));
        b.set(col('photos').doc(newId()), { url: p.url, caption: str(p.caption, 300), eventId, createdBy: admin.id, createdAt: now });
        bump(b, eventId, 1);
      }
      await b.commit();
      return send(res, 201, await galleryPhotos());
    }
    const ref = col('photos').doc(id || '_');
    const photo = id && data(await ref.get());
    if (!photo) throw fail(404, 'Photo not found');
    if (req.method === 'PUT') {
      const body = await readJson(req);
      const caption = 'caption' in body ? str(body.caption, 300) : photo.caption;
      const eventId = 'eventId' in body ? await checkEvent(str(body.eventId, 40)) : photo.eventId;
      const b = db.batch();
      b.update(ref, { caption, eventId });
      if (eventId !== photo.eventId) {
        if (photo.eventId && (await events.byId(photo.eventId))) bump(b, photo.eventId, -1);
        bump(b, eventId, 1);
      }
      await b.commit();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      const b = db.batch();
      b.delete(ref);
      if (photo.eventId && (await events.byId(photo.eventId))) bump(b, photo.eventId, -1);
      await b.commit();
      return send(res, 200, { ok: true });
    }
  }

  throw fail(404, 'Not found');
}
