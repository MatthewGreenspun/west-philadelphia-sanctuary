// Cloud Function entry point. Firebase Hosting sends /api/** and /uploads/** here (see firebase.json).
import { onRequest } from 'firebase-functions/v2/https';
import { handle } from './lib/api.js';

export const api = onRequest(
  {
    region: 'us-central1',
    memory: '512MiB',
    cpu: 1,
    concurrency: 40,
    maxInstances: 5, // plenty for a club site, and caps any surprise bill
    timeoutSeconds: 60,
  },
  handle,
);
