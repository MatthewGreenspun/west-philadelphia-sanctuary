// Firebase in the browser: Firebase Auth (sign-in) and App Check (proves requests come from this site).
// Loaded only when someone signs in or sends something, so plain page views stay light.
const SDK = 'https://www.gstatic.com/firebasejs/11.0.2';

// Public web app settings (not secrets: they identify the app, they don't grant access).
const CONFIG = {
  apiKey: 'AIzaSyCPvIWy0WM5-WRIaUOChCIm31UYrzR6v90',
  authDomain: 'west-phili-sanctuary.firebaseapp.com',
  projectId: 'west-phili-sanctuary',
  storageBucket: 'west-phili-sanctuary.firebasestorage.app',
  messagingSenderId: '63231942027',
  appId: '1:63231942027:web:dc998f16a96a557562638e',
};
const RECAPTCHA_SITE_KEY = '6LfqjBYuAAAAAA-IZ-PmUPvxprQzmUNMgxNfoMy8';

// Local development runs against the Firebase emulators, where App Check isn't used.
export const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

let loading;
export function loadFirebase() {
  return (loading ||= (async () => {
    const [appMod, authMod, checkMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      LOCAL ? null : import(`${SDK}/firebase-app-check.js`),
    ]);
    const app = appMod.initializeApp(LOCAL ? { ...CONFIG, projectId: 'demo-wpsc' } : CONFIG);
    // App Check first, so Firebase Auth requests carry a token too.
    const appCheck = checkMod
      ? checkMod.initializeAppCheck(app, { provider: new checkMod.ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: false })
      : null;
    const auth = authMod.getAuth(app);
    // The server keeps the session (a cookie); the browser doesn't need to stay signed in to Firebase.
    await authMod.setPersistence(auth, authMod.inMemoryPersistence);
    if (LOCAL) authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    return { auth, authMod, appCheck, checkMod };
  })().catch((err) => { loading = null; throw err; }));
}

// A fresh App Check token for an API request (cached by Firebase until it expires).
export async function appCheckToken() {
  if (LOCAL) return null;
  const { appCheck, checkMod } = await loadFirebase();
  return (await checkMod.getToken(appCheck, false)).token;
}

// Friendlier wording for Firebase Auth errors.
const AUTH_ERRORS = {
  'auth/invalid-credential': 'Email or password is incorrect',
  'auth/wrong-password': 'Email or password is incorrect',
  'auth/user-not-found': 'Email or password is incorrect',
  'auth/invalid-email': 'Please enter a valid email',
  'auth/missing-password': 'Please enter your password',
  'auth/email-already-in-use': 'An account with that email already exists — try signing in',
  'auth/weak-password': 'Password must be at least 8 characters',
  'auth/user-disabled': 'This account has been suspended',
  'auth/too-many-requests': 'Too many attempts — wait a few minutes and try again',
  'auth/network-request-failed': 'Network problem — check your connection and try again',
  'auth/popup-blocked': 'Your browser blocked the Google sign-in window — allow pop-ups for this site and try again',
  'auth/operation-not-allowed': 'Google sign-in isn’t turned on yet',
  'auth/unauthorized-domain': 'Google sign-in isn’t set up for this web address',
};
export const authMessage = (err) => AUTH_ERRORS[err?.code]
  || (String(err?.code || '').includes('app-check') ? 'We couldn’t verify your browser. Refresh the page and try again.' : err?.message || 'Something went wrong');
