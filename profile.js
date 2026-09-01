// profile.html only.

function onDataRefreshed() { renderProfilePanel(loadCachedProfile()); }

function loadCachedProfile() {
  try { const raw = localStorage.getItem(PROFILE_CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function saveCachedProfile(p) {
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p)); } catch (e) {}
}

function computeProfileStats() {
  const all = Object.values(tasksById);
  const daysWithTasks = new Set(all.map(t => t.date)).size;
  const catMinutes = {};
  all.forEach(t => { catMinutes[t.cat] = (catMinutes[t.cat] || 0) + Math.max(0, t.endMin - t.startMin); });
  let topCat = null, topMinutes = 0;
  Object.entries(catMinutes).forEach(([id, m]) => { if (m > topMinutes) { topMinutes = m; topCat = id; } });
  return { totalTasks: all.length, daysWithTasks, topCat: topCat && CAT_MAP[topCat] ? CAT_MAP[topCat].label : '—' };
}

function renderProfilePanel(profile) {
  const stats = computeProfileStats();
  document.getElementById('profileName').textContent = (profile && profile.name) || 'Signed in with Google';
  document.getElementById('profileEmail').textContent = (profile && profile.email) || '';
  const avatarEl = document.getElementById('profileAvatar');
  if (profile && profile.picture) {
    avatarEl.style.backgroundImage = `url(${profile.picture})`;
    avatarEl.textContent = '';
  } else {
    avatarEl.style.backgroundImage = '';
    avatarEl.textContent = ((profile && profile.name) || '?').slice(0, 1).toUpperCase();
  }
  document.getElementById('statTasks').textContent = stats.totalTasks;
  document.getElementById('statDays').textContent = stats.daysWithTasks;
  document.getElementById('statTopCat').textContent = stats.topCat;
}

async function refreshProfileFromNetwork() {
  if (!navigator.onLine) return;
  const token = await ensureFreshToken();
  if (!token) return;
  try {
    const profile = await fetchUserProfile(token);
    saveCachedProfile(profile);
    renderProfilePanel(profile);
  } catch (e) { /* keep showing cached/placeholder profile */ }
}

document.getElementById('profileSignOutBtn').onclick = doSignOut;

bootCore(() => {
  document.getElementById('profilePage').style.display = 'flex';
  renderProfilePanel(loadCachedProfile());
  refreshProfileFromNetwork();
});
