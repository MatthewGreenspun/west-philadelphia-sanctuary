# West Philadelphia Sanctuary website

The website for West Philadelphia Sanctuary (WPS), a space for community, care and collaboration in West Philadelphia. Live at https://west-phili-sanctuary.web.app. It has:

| Page | Address | What it's for |
| --- | --- | --- |
| Home | `/` | Club intro, next events, recent photos, a preview of the map |
| About | `/about` | Mission, about text, meeting time, contact, team |
| Events | `/events` | Upcoming events as a list or calendar, RSVP and interest forms, past events |
| Gallery | `/gallery` | Photos from past events, grouped by event |
| Third spaces | `/map` | Community map of third spaces in West Philly |
| Volunteer | `/volunteer` | Volunteer sign-up form |
| Club admin | `/admin` | For officers: manage everything above |

## Run it locally

```bash
npm install
npm run dev
```

This starts the Firebase emulators. Open http://localhost:3000 for the site and http://localhost:4000 for the emulator dashboard, where you can browse the data. You need Node 22, Java (for the Firestore emulator) and the Firebase CLI (`npm install -g firebase-tools`). Local data is saved to `emulator-data/` when you stop with Ctrl-C.

## Deploy to Firebase

The site runs on Firebase:
- **Hosting** serves the pages in `public/`.
- **Cloud Functions** runs one function, `api`, which handles `/api/**` and `/uploads/**`.
- **Firestore** holds all the data.
- **Cloud Storage** holds uploaded photos.

Cloud Functions needs the Blaze (pay-as-you-go) plan, but a club site stays well inside the free amounts.

One-time setup:

1. In the Firebase console, create a project, upgrade it to Blaze, and create a Firestore database and a Storage bucket.
2. Then, from this folder:

   ```bash
   firebase login
   firebase use --add        # pick the project, alias "default"
   firebase deploy
   ```

After that, `npm run deploy` publishes changes.

**Choosing admins:** the first account created becomes an admin. To choose admins by email instead, copy `.env.example` to `.env` (git ignores it), set `ADMIN_EMAILS=you@example.com,friend@example.com`, and deploy again.

## First steps for the club

1. **Create the first account.** The first account created becomes an admin. Sign up yourself before sharing the link, then click the link in the verification email (admin tools need a verified email). To choose admins by email instead, see "Admins" below.
2. **Fill in About & contact.** Open **Club admin** from your account menu, then the **About & contact** tab. The starting text is a placeholder: replace it with your club's own words, and add your email, Instagram, meeting time and team.
3. **Add events** from the **Events** tab. They appear on the home page and the calendar right away. Turn off "Show this event on the site" to save a draft.
4. **Add photos** from the **Gallery** tab after events.

## What officers can do (Club admin)

- **Events:** create, edit, delete, set a cover photo, link the event to a place on the map, and choose the sign-up type:
  - **RSVP:** going or interested;
  - **Interest form only;**
  - **No sign-up.**

  You can set a spot limit. Once it's full, new "going" sign-ups go on a waitlist. A spot that opens up isn't filled from the waitlist automatically: change someone's status from the sign-up list to let them in.
- **Sign-ups:** see who signed up, change status, remove people, copy the emails of everyone going, or download a CSV.
- **Volunteers:** each form arrives as **New**. Mark people Contacted, Active or Archived, add private notes, search, download a CSV, or delete a form if someone asks.
- **Gallery:** upload several photos at once, attach them to an event, add captions, delete.
- **About & contact:** the home page headline and intro, the About text, meeting time, email, Instagram and team members (with photos).
- **Map:** shows how many map items are waiting and links to map moderation. Map moderation is on the map page, where you also manage people and admin access (**People** tab).

Visitors don't need an account to RSVP, fill in an interest form or volunteer. Signing up for an event remembers the sign-up in that browser, so the person can change or cancel it there.

Events offer "Add to Google Calendar" and an `.ics` file for Apple Calendar and Outlook. `/api/calendar.ics` is a feed of all club events that people can subscribe to.

## How it works

- **index.js:** the Cloud Function entry point.
- **lib/api.js:** the API: accounts, the map, moderation and photo uploads.
- **lib/club.js:** events, sign-ups, volunteer forms, gallery and site text.
- **lib/db.js:** Firestore access. The browser never talks to Firestore or Storage directly (`firestore.rules` and `storage.rules` block it); everything goes through the function.
- **lib/auth.js:** sign-in. People sign up and sign in with Firebase Auth in the browser (`public/firebase.js`). The server swaps that sign-in for a Firebase session cookie named `__session`, the only cookie Firebase Hosting passes to functions. Names, roles and suspensions are stored in the Firestore `users` collection.
- **lib/http.js:** shared helpers for API routes.
- **public/:** the pages. `site.js` and `site.css` hold the shared header, sign-in, footer and styles. `pages/*.js` has one script per page, `app.js` runs the map page, and `map-style.js` is the custom map style.
- **firebase.json:** Hosting routes, clean URLs (`/about` serves `about.html`) and emulator ports.

Event times are entered and shown in Philadelphia time.

## Third spaces map

The map covers West Philadelphia, from the Schuylkill River to Cobbs Creek and City Line Ave. New spaces must be inside that area. The outline is in `public/region.js`. It's approximate, so adjust it there if a legitimate spot near the edge gets rejected.

Map features include:

- category pins with clustering;
- search and filters: amenities, noise, cost, neighborhood, open now, open late;
- distance from Penn or from you;
- reviews;
- live "how busy is it?" reports;
- saved spaces and problem reports;
- adding or editing spaces with a photo upload and an hours editor.

The address search uses OpenStreetMap's Nominatim service.

**Map moderation:**
- New spaces from members wait for review.
- Edits to published spaces from anyone but an admin become suggestions with a before/after comparison.
- Admins can remove spaces and suspend accounts.

## Admins

The first account becomes an admin. To choose admins by email instead, set `ADMIN_EMAILS` in a `.env` file (see "Deploy to Firebase").

Admins can also make other people admins from Map → Moderation → **People**.

## Data and backups

- **Data:** everything is in Firestore, and photos are in Cloud Storage under `uploads/`. Volunteer forms and sign-ups include names and emails, so keep backups private.
- **Backups:** Firestore has scheduled backups (Firestore → Disaster recovery in the console), or export with:

  ```bash
  gcloud firestore export gs://YOUR-BUCKET/backups
  ```
- **Starter spaces:** when `seed/spaces.json` changes, bump `SEED_VERSION` in `lib/db.js`. On the next start, starter spaces nobody has edited get updated.
- **Rate limits** are stored in the `rateLimits` collection. Its `expireAt` field has a TTL policy (in `firestore.indexes.json`), so Firestore deletes old entries automatically.

## Protection from abuse

- **App Check:** every change sent to the API (forms, sign-ups, RSVPs, uploads, edits) must carry a Firebase App Check token. It's issued by reCAPTCHA Enterprise only to real visitors on the site, so scripts calling the API directly are rejected. App Check is also enforced on Firebase Auth, Firestore and Storage. Locally, in the emulators, App Check is skipped.
- **Firebase Auth:** handles passwords, brute-force protection, "Forgot password?" emails and email verification.
- **Verified email required** for anything other people see: adding or editing spaces, reviews, problem reports, photo uploads. Admins must also have a verified email to use admin tools.
- **Suspending someone** (Map → Moderation → People) disables their Firebase account and ends their sessions right away.
- **Rate limits** per network and per account on sign-ins, forms, RSVPs, reviews, uploads and busyness reports. They're stored in Firestore, so they apply across all server instances.
- **Hidden bot-trap fields** on the volunteer and RSVP forms.
- **No direct database access:** Firestore and Storage rules block the browser completely. Only the function can read or write.
- **Cost guard:** the function is capped at 5 instances. Set a budget alert in Google Cloud billing (for example $5) so you hear about any surprise.

The reCAPTCHA Enterprise key only works on `west-phili-sanctuary.web.app`, `west-phili-sanctuary.firebaseapp.com` and `localhost`. If you add a custom domain, add it to the key in Google Cloud → Security → reCAPTCHA. reCAPTCHA Enterprise is free for the first 10,000 checks a month, and the site only asks for a check when someone sends something.

## Still to know

- **No confirmation emails** for volunteer forms or RSVPs (Firebase only sends sign-in emails). Officers follow up by hand, using the CSV or "copy emails".
- **RSVP emails aren't verified.** Visitors don't need an account to RSVP, so someone could type another person's email. App Check, rate limits and the bot trap keep this to individual mischief rather than mass spam.

## API

Public:

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/site` | site text and counts |
| GET | `/api/events` | all published events |
| GET | `/api/events/:id` | |
| GET | `/api/events/:id/calendar.ics` | one event as a calendar file |
| GET | `/api/calendar.ics` | calendar feed of all events |
| POST | `/api/events/:id/signups` | `{ name, email, status: going \| interested, note }` |
| DELETE | `/api/events/:id/signups/:signupId` | `{ token }` from the sign-up response |
| POST | `/api/volunteers` | `{ name, email, phone, affiliation, school, interests[], availability[], howHeard, message }` |
| GET | `/api/gallery` | |
| POST | `/api/auth/session` | `{ idToken, name }` from a fresh Firebase Auth sign-in; sets the session cookie |
| | `/api/auth/me`, `/api/auth/logout`, `/api/spaces/*`, `/api/uploads` | the rest of accounts, and the map |

Admins only (under `/api/admin`):

| Method | Path | Notes |
| --- | --- | --- |
| GET | `summary` | counts for the admin badge |
| PUT | `site` | site text and team |
| POST | `events` | create an event |
| PUT, DELETE | `events/:id` | edit or delete an event |
| GET | `events/:id/signups` | sign-up list |
| GET | `events/:id/signups.csv` | sign-ups as CSV |
| POST | `events/:id/signups/:signupId` | `{ status }` |
| DELETE | `events/:id/signups/:signupId` | remove a sign-up |
| GET | `volunteers` | volunteer forms |
| GET | `volunteers.csv` | volunteer forms as CSV |
| PUT | `volunteers/:id` | `{ status, notes }` |
| DELETE | `volunteers/:id` | delete a form |
| GET | `gallery` | all photos |
| POST | `gallery` | `{ photos: [{ url, caption, eventId }] }` |
| PUT | `gallery/:id` | `{ caption, eventId }` |
| DELETE | `gallery/:id` | delete a photo |
| | `queue`, `spaces/*`, `users/*` | map moderation |

All writes must be sent as JSON (which blocks cross-site form attacks) with an `X-Firebase-AppCheck` header.
