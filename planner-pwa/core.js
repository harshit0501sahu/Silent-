// Shared across every page: constants, local storage, background sync, theme,
// and the drawer/gate chrome (injected here once so it's defined in exactly
// one place instead of duplicated across index/summary/profile/export.html).

const CATEGORIES = [
  { id: 'class', label: 'Class', color: 'var(--class)' },
  { id: 'labs', label: 'Labs', color: 'var(--labs)' },
  { id: 'null', label: 'Null', color: 'var(--null)' },
  { id: 'sleep', label: 'Sleep', color: 'var(--sleep)' },
  { id: 'wasted', label: 'Wasted', color: 'var(--wasted)' },
  { id: 'work', label: 'Work', color: 'var(--work)' },
];
const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const DEFAULT_CAT = CATEGORIES[0].id;
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const LOCAL_CACHE_KEY = 'planner_local_cache';
const PENDING_OPS_KEY = 'planner_pending_ops';
const PROFILE_CACHE_KEY = 'planner_profile';
const PUSH_INTERVAL_MS = 15000;
const PULL_INTERVAL_MS = 60000;
const MIRROR_INTERVAL_MS = 120000;

let sheetId = null;
let backup1Id = null;
let backup2Id = null;
let lastMirrorAt = 0;
let lastPullAt = 0;
let tasksById = {};
let tasksByDate = {};
let pendingOps = {}; // taskId -> {type:'upsert', task} | {type:'delete', row}
let syncTimer = null;
let syncDebounceTimer = null;
let syncInFlight = false;

function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fmtTime(mins) { let h = Math.floor(mins / 60), m = mins % 60; const ap = h >= 12 ? 'PM' : 'AM'; let h12 = h % 12; if (h12 === 0) h12 = 12; return `${h12}:${pad(m)} ${ap}`; }
function fmtHourLabel(h) { const ap = h >= 12 ? 'PM' : 'AM'; let h12 = h % 12; if (h12 === 0) h12 = 12; return `${h12} ${ap}`; }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function genId() { return (crypto.randomUUID ? crypto.randomUUID() : 't' + Date.now() + Math.random().toString(16).slice(2)); }
function catColorHex(id) { return getComputedStyle(document.documentElement).getPropertyValue('--' + id).trim() || '#8d97c2'; }
function hexToRgb(hex) { const h = hex.replace('#', ''); return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)]; }
function fmtDuration(mins) {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ---------- Local persistence ----------
function saveLocalCache() {
  try { localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ tasksById, tasksByDate })); } catch (e) {}
}
function loadLocalCache() {
  try { const raw = localStorage.getItem(LOCAL_CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function clearLocalCache() {
  try { localStorage.removeItem(LOCAL_CACHE_KEY); } catch (e) {}
}
function savePendingOps() {
  try { localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(pendingOps)); } catch (e) {}
}
function loadPendingOps() {
  try { const raw = localStorage.getItem(PENDING_OPS_KEY); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
function clearPendingOpsCache() {
  try { localStorage.removeItem(PENDING_OPS_KEY); } catch (e) {}
}

function setSync(state, text) {
  const dot = document.getElementById('syncDot');
  const label = document.getElementById('syncText');
  const chip = document.getElementById('syncChip');
  if (!dot) return;
  dot.className = 'sync-pip' + (state === 'busy' ? ' busy' : state === 'pending' ? ' pending' : state === 'err' ? ' err' : state === 'offline' ? ' offline' : '');
  if (label) label.textContent = text || '';
  if (chip) chip.classList.toggle('busy', state === 'busy');
}

// ---------- Gate ----------
function showGate(msg, showSpinner, showButton) {
  document.getElementById('gate').style.display = 'flex';
  document.getElementById('gateMsg').textContent = msg;
  document.getElementById('gateSpinner').style.display = showSpinner ? 'block' : 'none';
  document.getElementById('signInBtn').style.display = showButton ? 'flex' : 'none';
}
function hideGate() {
  document.getElementById('gate').style.display = 'none';
}

// ---------- Boot: every page calls bootCore(onReady) once ----------
// If local data + a known sheet already exist, the page renders instantly —
// no network, no auth wait, works fully offline. Only a genuinely first-time
// (or cache-cleared) visit needs the gated sign-in flow, and that can happen
// on ANY page since each is independently loadable.
async function bootCore(onReady) {
  injectChrome();
  applyTheme(localStorage.getItem('planner_theme') || 'dark');
  wireChrome();

  const cachedSheetId = localStorage.getItem('planner_sheet_id');
  const cache = loadLocalCache();

  if (cachedSheetId && cache) {
    sheetId = cachedSheetId;
    backup1Id = localStorage.getItem('planner_backup1_id');
    backup2Id = localStorage.getItem('planner_backup2_id');
    tasksById = cache.tasksById || {};
    tasksByDate = cache.tasksByDate || {};
    pendingOps = loadPendingOps();
    hideGate();
    updateInstallItemVisibility();
    updateDrawerFoot();
    onReady();
    startSyncLoop();
    return;
  }

  showGate('Checking your Google sign-in…', true, false);
  initAuth(async (ok) => {
    if (ok) { await coreSignInFlow(onReady); return; }
    showGate('Sign in to load your planner.', false, true);
  });
  document.getElementById('signInBtn').onclick = () => {
    document.getElementById('gateError').textContent = '';
    showGate('Opening Google sign-in…', true, false);
    signInInteractive(async (ok, err) => {
      if (ok) { await coreSignInFlow(onReady); return; }
      showGate('Sign in to load your planner.', false, true);
      document.getElementById('gateError').textContent = err ? `Couldn't sign in (${err}). Try again.` : "Couldn't sign in. Try again.";
    });
  };
}

async function coreSignInFlow(onReady) {
  showGate('Loading your planner…', true, false);
  try {
    const token = await ensureFreshToken();
    if (!token) { showGate('Sign in to load your planner.', false, true); return; }
    const ids = await findOrCreateAllSheets(token);
    sheetId = ids.primary; backup1Id = ids.backup1; backup2Id = ids.backup2;
    const remote = await fetchAllTasks(token, sheetId);
    tasksById = remote.tasksById; tasksByDate = remote.tasksByDate;
    pendingOps = {};
    saveLocalCache(); savePendingOps();
    lastPullAt = Date.now();
    hideGate();
    updateInstallItemVisibility();
    updateDrawerFoot();
    onReady();
    startSyncLoop();
  } catch (e) {
    showGate('Could not load your planner.', false, true);
    document.getElementById('gateError').textContent = e.message;
  }
}

function doSignOut() {
  if (window.google && google.accounts && google.accounts.oauth2 && accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  clearCachedToken();
  clearLocalCache();
  clearPendingOpsCache();
  localStorage.removeItem('planner_sheet_id');
  localStorage.removeItem('planner_backup1_id');
  localStorage.removeItem('planner_backup2_id');
  localStorage.removeItem('planner_last_backup_at');
  localStorage.removeItem(PROFILE_CACHE_KEY);
  location.href = 'index.html';
}

// ---------- Background sync (push local changes, pull remote changes) ----------
function triggerSyncSoon() {
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(trySync, 800);
}

function startSyncLoop() {
  trySync();
  syncTimer = setInterval(trySync, PUSH_INTERVAL_MS);
  window.addEventListener('online', trySync);
  window.addEventListener('offline', () => setSync('offline', 'Offline'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) trySync(); });
}

async function trySync(force) {
  if (syncInFlight) return;
  if (!navigator.onLine) { setSync('offline', 'Offline'); return; }
  syncInFlight = true;
  try {
    const pendingCount = Object.keys(pendingOps).length;
    setSync('busy', pendingCount > 0 ? 'Syncing…' : 'Checking…');

    const token = await ensureFreshToken();
    if (!token) {
      setSync(pendingCount > 0 ? 'pending' : 'err', pendingCount > 0 ? `${pendingCount} pending — tap to sign in` : 'Tap to sign in');
      return;
    }

    for (const [id, op] of Object.entries(pendingOps)) {
      try {
        if (op.type === 'delete') {
          if (op.row) await clearTaskRow(token, sheetId, op.row);
        } else {
          const t = op.task;
          if (t.row) {
            await updateTaskRow(token, sheetId, t.row, t);
          } else {
            const row = await appendTask(token, sheetId, t);
            t.row = row;
            if (tasksById[id]) { tasksById[id].row = row; saveLocalCache(); }
          }
        }
        delete pendingOps[id];
        savePendingOps();
      } catch (e) {
        // Leave this one queued; we'll retry it on the next cycle.
      }
    }

    if (force || Date.now() - lastPullAt > PULL_INTERVAL_MS) {
      lastPullAt = Date.now();
      const remote = await fetchAllTasks(token, sheetId);
      mergeRemoteIntoLocal(remote);
      if (typeof onDataRefreshed === 'function') onDataRefreshed();
    }

    await maybeMirrorBackups(token);

    const remaining = Object.keys(pendingOps).length;
    setSync(remaining === 0 ? 'ok' : 'pending', remaining === 0 ? 'Synced' : `${remaining} pending`);
  } catch (e) {
    setSync('err', 'Sync error — tap to retry');
  } finally {
    syncInFlight = false;
  }
}

// Remote wins for any task that has no unpushed local edit queued, so a hand-edit
// in the raw Sheet (or a change from another device) shows up here — but a local
// change still waiting to be pushed is never silently overwritten.
function mergeRemoteIntoLocal(remote) {
  Object.entries(remote.tasksById).forEach(([id, rt]) => {
    if (pendingOps[id]) return;
    tasksById[id] = rt;
  });
  Object.keys(tasksById).forEach(id => {
    if (!remote.tasksById[id] && !pendingOps[id]) delete tasksById[id];
  });
  tasksByDate = {};
  Object.values(tasksById).forEach(t => { (tasksByDate[t.date] = tasksByDate[t.date] || []).push(t.id); });
  saveLocalCache();
}

// Full-snapshot mirror to the 2 backup sheets — only runs once the primary is
// fully caught up (no pending ops) and not more often than MIRROR_INTERVAL_MS,
// so backups are a clean, eventually-consistent copy rather than 3x the writes.
async function maybeMirrorBackups(token) {
  if (!backup1Id || !backup2Id) {
    try {
      const ids = await findOrCreateAllSheets(token);
      sheetId = ids.primary;
      backup1Id = ids.backup1;
      backup2Id = ids.backup2;
    } catch (e) { return; }
  }
  if (Object.keys(pendingOps).length > 0) return;
  if (Date.now() - lastMirrorAt < MIRROR_INTERVAL_MS) return;
  lastMirrorAt = Date.now();
  try {
    await mirrorTasksToSheet(token, backup1Id, tasksById);
    await mirrorTasksToSheet(token, backup2Id, tasksById);
    localStorage.setItem('planner_last_backup_at', String(Date.now()));
    updateDrawerFoot();
  } catch (e) {
    // Retry on the next sync cycle.
  }
}

function updateDrawerFoot() {
  const el = document.getElementById('drawerFoot');
  if (!el) return;
  const ts = parseInt(localStorage.getItem('planner_last_backup_at') || '0', 10);
  el.textContent = ts
    ? `Backed up to 2 extra sheets — last mirrored ${timeAgo(ts)}.`
    : 'Data stored in your own Google Sheet, mirrored to 2 backup sheets.';
}
function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ---------- Theme (dark default, toggle persisted in localStorage) ----------
function applyTheme(theme) {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  document.querySelectorAll('#themeSeg .seg-btn').forEach(b => b.classList.toggle('selected', b.dataset.theme === theme));
  try { localStorage.setItem('planner_theme', theme); } catch (e) {}
}

// ---------- Install as a real app (not a browser shortcut) ----------
let deferredInstallPrompt = null;
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}
function updateInstallItemVisibility() {
  const item = document.getElementById('installItem');
  if (!item) return;
  if (isStandalone()) { item.style.display = 'none'; return; }
  item.style.display = (deferredInstallPrompt || isIOS()) ? 'flex' : 'none';
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  updateInstallItemVisibility();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const hint = document.getElementById('installHint');
  if (hint) hint.style.display = 'none';
  updateInstallItemVisibility();
});

// ---------- Gate + Drawer markup (defined once, injected on every page) ----------
const GATE_HTML = `
<div class="gate" id="gate">
  <h1>Planner</h1>
  <p id="gateMsg">Checking your Google sign-in&hellip;</p>
  <div class="spinner" id="gateSpinner"></div>
  <button class="btn-google" id="signInBtn" style="display:none;">
    <svg viewBox="0 0 48 48"><path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/><path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/><path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/></svg>
    Sign in with Google
  </button>
  <p class="gate-error" id="gateError"></p>
</div>`;

const DRAWER_HTML = `
<div class="drawer-backdrop" id="drawerBackdrop"></div>
<aside class="drawer" id="drawer">
  <a class="drawer-hero" href="index.html">
    <div class="stars" style="position:absolute;inset:0;background-image:radial-gradient(1px 1px at 25% 30%, #cfd6ff, transparent),radial-gradient(1px 1px at 70% 20%, #cfd6ff, transparent),radial-gradient(1px 1px at 85% 45%, #cfd6ff, transparent);"></div>
    <svg viewBox="0 0 300 90" preserveAspectRatio="none"><polygon points="0,90 0,55 30,25 70,55 110,20 150,50 190,30 230,55 270,35 300,50 300,90" fill="#141c48"/></svg>
    <div class="drawer-brand">
      <div class="drawer-mark">P</div>
      <div class="drawer-word">Planner</div>
    </div>
  </a>
  <nav class="drawer-nav">
    <a class="drawer-item" href="profile.html" id="profileItem"><span class="di-icon">&#128100;</span> Profile</a>
    <a class="drawer-item" href="summary.html" id="summaryItem"><span class="di-icon">&#128202;</span> Summary</a>
    <a class="drawer-item" href="tasks.html" id="tasksItem"><span class="di-icon">&#9745;</span> Google Tasks</a>
    <div class="drawer-item drawer-theme-row">
      <span class="di-icon">&#9788;</span>
      <span class="drawer-theme-label">Theme</span>
      <div class="seg-control" id="themeSeg">
        <button class="seg-btn selected" data-theme="dark" type="button">Dark</button>
        <button class="seg-btn" data-theme="light" type="button">Light</button>
      </div>
    </div>
    <button class="drawer-item" id="installItem" style="display:none;"><span class="di-icon">&#8991;</span> Install App</button>
    <p class="drawer-hint" id="installHint" style="display:none;"></p>
    <a class="drawer-item" href="export.html" id="exportItem"><span class="di-icon">&#8681;</span> Export PDF</a>
    <button class="drawer-item" id="openSheetItem"><span class="di-icon">&#128203;</span> Open in Google Sheets</button>
    <div class="drawer-spacer"></div>
    <button class="drawer-item drawer-danger" id="drawerSignOut"><span class="di-icon">&#8594;</span> Sign out</button>
  </nav>
  <div class="drawer-foot" id="drawerFoot">Data stored in your own Google Sheet, mirrored to 2 backup sheets.</div>
</aside>`;

function injectChrome() {
  const gateMount = document.getElementById('gateMount');
  if (gateMount) gateMount.outerHTML = GATE_HTML;
  const drawerMount = document.getElementById('drawerMount');
  if (drawerMount) drawerMount.outerHTML = DRAWER_HTML;
}

function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawerBackdrop').classList.add('open');
  document.querySelectorAll('.drawer-item').forEach((el, i) => {
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = '';
    el.style.animationDelay = (i * 40) + 'ms';
  });
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawerBackdrop').classList.remove('open');
}

function wireChrome() {
  const menuBtn = document.getElementById('menuBtn');
  if (menuBtn) menuBtn.onclick = openDrawer;
  document.getElementById('drawerBackdrop').onclick = closeDrawer;
  document.querySelectorAll('#themeSeg .seg-btn').forEach(b => b.onclick = () => applyTheme(b.dataset.theme));
  document.getElementById('installItem').onclick = async () => {
    if (deferredInstallPrompt) {
      closeDrawer();
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      updateInstallItemVisibility();
      return;
    }
    const hint = document.getElementById('installHint');
    const showing = hint.style.display === 'block';
    hint.textContent = isIOS()
      ? 'Tap the Share icon in Safari’s toolbar, then "Add to Home Screen." This adds a real app icon that opens full-screen — not a browser shortcut.'
      : 'This browser doesn’t support one-tap install. Open this page in Chrome or Edge to install it as a real app.';
    hint.style.display = showing ? 'none' : 'block';
  };
  document.getElementById('openSheetItem').onclick = () => {
    closeDrawer();
    if (sheetId) window.open(`https://docs.google.com/spreadsheets/d/${sheetId}/edit`, '_blank');
  };
  document.getElementById('drawerSignOut').onclick = () => {
    closeDrawer();
    doSignOut();
  };
  const syncChip = document.getElementById('syncChip');
  if (syncChip) {
    syncChip.onclick = async () => {
      if (!navigator.onLine) return;
      const token = await ensureFreshToken();
      if (!token) { signInInteractive((ok) => { if (ok) trySync(true); }); return; }
      trySync(true);
    };
  }
  const page = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.drawer-item[href]').forEach(a => {
    if (a.getAttribute('href') === page) a.classList.add('active');
  });
}

// Installed apps don't get a fresh browser-tab navigation to trigger a service
// worker update check, so they can otherwise get stuck on an old version
// indefinitely. Force a check on every load, and reload once automatically
// as soon as a newer version actually takes control.
if ('serviceWorker' in navigator) {
  let swRefreshed = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshed) return;
    swRefreshed = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.update().catch(() => {});
    }).catch(() => {});
  });
}
