// Google Identity Services (GIS) OAuth token flow.
// Scopes: drive.file (the app can only see/edit files IT creates, never your
// whole Drive) plus tasks (full read/write on your Google Tasks lists, needed
// for the Tasks page).
//
// The GIS script is loaded dynamically (not a static <script> tag) so that if the
// app boots while offline, we can retry loading it later once connectivity returns,
// instead of being stuck forever because a static tag only ever tries once.

let accessToken = null;
let tokenExpiresAt = 0;
let tokenClient = null;
let gisLoadPromise = null;

const TOKEN_CACHE_KEY = 'planner_google_token';

// Reusing a still-valid token from a previous visit means reopening the app
// needs no popup and no click at all, for as long as that token lasts (~1hr).
function loadCachedToken() {
  try {
    const raw = localStorage.getItem(TOKEN_CACHE_KEY);
    if (!raw) return null;
    const { access_token, expires_at } = JSON.parse(raw);
    if (access_token && expires_at && Date.now() < expires_at - 60000) return { access_token, expires_at };
  } catch (e) { /* ignore malformed cache */ }
  return null;
}
function saveCachedToken(access_token, expires_at) {
  try { localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({ access_token, expires_at })); } catch (e) {}
}
function clearCachedToken() {
  try { localStorage.removeItem(TOKEN_CACHE_KEY); } catch (e) {}
}

function loadGisScript() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisLoadPromise = null; reject(new Error('offline')); };
    document.head.appendChild(s);
  });
  return gisLoadPromise;
}

// Basic Google account info (name, email, avatar) for the Profile panel.
async function fetchUserProfile(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Could not load profile');
  return res.json(); // { name, email, picture, ... }
}

async function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  await loadGisScript();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/drive.file openid email profile https://www.googleapis.com/auth/tasks',
    callback: () => {},
  });
  return tokenClient;
}

// Fast path: reuse a cached token instantly. Otherwise makes a best-effort silent
// attempt (browsers often block this since it's not a user click — that's expected,
// not a bug) before falling back to showing the sign-in button.
async function initAuth(onReady) {
  const cached = loadCachedToken();
  if (cached) {
    accessToken = cached.access_token;
    tokenExpiresAt = cached.expires_at;
    onReady(true);
    return;
  }

  try {
    await ensureTokenClient();
  } catch (e) {
    onReady(false);
    return;
  }

  let settled = false;
  tokenClient.callback = (resp) => {
    settled = true;
    if (resp.error) { onReady(false); return; }
    accessToken = resp.access_token;
    tokenExpiresAt = Date.now() + resp.expires_in * 1000;
    saveCachedToken(accessToken, tokenExpiresAt);
    onReady(true);
  };
  tokenClient.requestAccessToken({ prompt: '' });

  setTimeout(() => {
    if (!settled) { settled = true; onReady(false); }
  }, 1200);
}

// User-gesture-triggered sign-in. No forced 'consent' prompt — Google shows only
// what's actually needed: nothing/one-tap for a returning user, full consent only
// the very first time this Google account authorizes the app.
async function signInInteractive(onReady) {
  try {
    await ensureTokenClient();
  } catch (e) {
    onReady(false, 'offline');
    return;
  }
  tokenClient.callback = (resp) => {
    if (resp.error) { onReady(false, resp.error); return; }
    accessToken = resp.access_token;
    tokenExpiresAt = Date.now() + resp.expires_in * 1000;
    saveCachedToken(accessToken, tokenExpiresAt);
    onReady(true);
  };
  tokenClient.requestAccessToken({ prompt: '' });
}

// Returns a valid access token, reusing the cache or silently refreshing as needed.
// Returns null (never throws) if no token can be obtained right now — callers treat
// that as "sync later" rather than a hard failure.
async function ensureFreshToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 60000) return accessToken;
  const cached = loadCachedToken();
  if (cached) { accessToken = cached.access_token; tokenExpiresAt = cached.expires_at; return accessToken; }
  try {
    await ensureTokenClient();
  } catch (e) {
    return null;
  }
  return new Promise((resolve) => {
    tokenClient.callback = (resp) => {
      if (resp.error) { resolve(null); return; }
      accessToken = resp.access_token;
      tokenExpiresAt = Date.now() + resp.expires_in * 1000;
      saveCachedToken(accessToken, tokenExpiresAt);
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}
