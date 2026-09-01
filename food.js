// food.html only: daily meal-adherence tracker (Breakfast/Lunch/Snacks/Dinner
// + free-form "outside" entries), stored in a 'Food' tab of the same primary
// spreadsheet the day planner already uses.

const MEALS = [
  { id: 'breakfast', label: 'Breakfast', icon: '\u{1F305}' },
  { id: 'lunch', label: 'Lunch', icon: '\u{1F35B}' },
  { id: 'snacks', label: 'Snacks', icon: '\u{1F36A}' },
  { id: 'dinner', label: 'Dinner', icon: '\u{1F319}' },
];
const FOOD_CACHE_KEY = 'planner_food_cache';

let selectedFoodDate = new Date();
let foodById = {};
let foodByDate = {};

function saveLocalFoodCache() {
  try { localStorage.setItem(FOOD_CACHE_KEY, JSON.stringify({ foodById, foodByDate })); } catch (e) {}
}
function loadLocalFoodCache() {
  try { const raw = localStorage.getItem(FOOD_CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

function showFoodError(msg) {
  const el = document.getElementById('foodError');
  el.textContent = msg;
  el.classList.add('show');
}
function clearFoodError() {
  const el = document.getElementById('foodError');
  el.textContent = '';
  el.classList.remove('show');
}

// ---------- Date nav ----------
function renderFoodDateNav() {
  const d = selectedFoodDate;
  document.getElementById('foodDateBanner').innerHTML = `
    <div class="big-num">${d.getDate()}</div>
    <div class="dcol">
      <div class="dow">${DOW_FULL[d.getDay()]}</div>
      <div class="ym">${MONTHS[d.getMonth()]} ${d.getFullYear()}</div>
    </div>`;
}
document.getElementById('foodPrevDay').onclick = () => { const d = new Date(selectedFoodDate); d.setDate(d.getDate() - 1); selectedFoodDate = d; renderFoodDay(); };
document.getElementById('foodNextDay').onclick = () => { const d = new Date(selectedFoodDate); d.setDate(d.getDate() + 1); selectedFoodDate = d; renderFoodDay(); };

// ---------- Rendering ----------
function renderFoodDay() {
  renderFoodDateNav();
  const ds = dateStr(selectedFoodDate);
  const ids = foodByDate[ds] || [];
  const entries = ids.map(id => foodById[id]).filter(Boolean);

  const eatenCount = MEALS.filter(m => entries.some(e => e.meal === m.id && e.status === 'eaten')).length;
  document.getElementById('mealProgress').textContent = `${eatenCount}/${MEALS.length} meals logged`;

  const list = document.getElementById('mealList');
  list.innerHTML = '';
  MEALS.forEach(m => {
    const entry = entries.find(e => e.meal === m.id);
    const status = entry ? entry.status : '';
    const card = document.createElement('div');
    card.className = 'meal-card';
    card.innerHTML = `
      <div class="meal-info"><span class="meal-icon">${m.icon}</span><span class="meal-label">${m.label}</span></div>
      <div class="meal-actions">
        <button type="button" class="meal-btn eaten${status === 'eaten' ? ' selected' : ''}" data-meal="${m.id}" data-status="eaten">Eaten</button>
        <button type="button" class="meal-btn skipped${status === 'skipped' ? ' selected' : ''}" data-meal="${m.id}" data-status="skipped">Skipped</button>
      </div>`;
    list.appendChild(card);
  });
  list.querySelectorAll('.meal-btn').forEach(b => { b.onclick = () => setMealStatus(b.dataset.meal, b.dataset.status); });

  const extras = entries.filter(e => e.meal === 'extra');
  const extraList = document.getElementById('extraList');
  extraList.innerHTML = '';
  if (extras.length === 0) {
    extraList.innerHTML = '<div class="empty-state">No extra food logged.</div>';
  } else {
    extras.forEach(e => {
      const row = document.createElement('div');
      row.className = 'extra-row';
      row.innerHTML = `<span class="extra-note">${escapeHtml(e.note)}</span><button class="extra-del" aria-label="Delete">&times;</button>`;
      row.querySelector('.extra-del').onclick = () => deleteFoodEntry(e.id);
      extraList.appendChild(row);
    });
  }
}

// ---------- Writes (optimistic local update, then push to the Sheet) ----------
// Tapping an already-selected status again clears it back to "not logged" —
// that's a real state (distinct from "skipped"), so the row is removed rather
// than left with an empty status string.
async function setMealStatus(mealId, newStatus) {
  clearFoodError();
  const ds = dateStr(selectedFoodDate);
  const id = `${ds}_${mealId}`;
  const existing = foodById[id];

  if (existing && existing.status === newStatus) {
    const row = existing.row;
    delete foodById[id];
    foodByDate[ds] = (foodByDate[ds] || []).filter(x => x !== id);
    saveLocalFoodCache();
    renderFoodDay();
    if (row) {
      try {
        const token = await ensureFreshToken();
        if (token) await clearFoodEntry(token, sheetId, row);
      } catch (e) { showFoodError(`Couldn't update: ${e.message}`); }
    }
    return;
  }

  const entry = existing || { id, date: ds, meal: mealId, note: '', row: null };
  entry.status = newStatus;
  foodById[id] = entry;
  if (!existing) (foodByDate[ds] = foodByDate[ds] || []).push(id);
  saveLocalFoodCache();
  renderFoodDay();
  try {
    const token = await ensureFreshToken();
    if (!token) throw new Error('Sign-in required.');
    const row = await upsertFoodEntry(token, sheetId, entry);
    // If this entry got cleared locally (a quick toggle-off) while the append
    // was in flight, foodById[id] no longer points at it — the row that just
    // landed on the server is now orphaned and would reappear on next sync,
    // so delete it immediately instead of recording its row number.
    if (foodById[id] === entry) {
      entry.row = row;
      saveLocalFoodCache();
    } else if (!foodById[id]) {
      clearFoodEntry(token, sheetId, row).catch(() => {});
    }
  } catch (e) {
    showFoodError(`Couldn't save: ${e.message}`);
  }
}

async function deleteFoodEntry(id) {
  clearFoodError();
  const e = foodById[id];
  if (!e) return;
  const ds = e.date;
  delete foodById[id];
  foodByDate[ds] = (foodByDate[ds] || []).filter(x => x !== id);
  saveLocalFoodCache();
  renderFoodDay();
  if (e.row) {
    try {
      const token = await ensureFreshToken();
      if (token) await clearFoodEntry(token, sheetId, e.row);
    } catch (err) { showFoodError(`Couldn't delete: ${err.message}`); }
  }
}

// ---------- Extra food sheet ----------
function openExtraSheet() {
  clearExtraError();
  document.getElementById('extraNote').value = '';
  document.getElementById('extraBackdrop').classList.add('open');
  document.getElementById('extraSheet').classList.add('open');
  setTimeout(() => document.getElementById('extraNote').focus(), 200);
}
function closeExtraSheet() {
  document.getElementById('extraBackdrop').classList.remove('open');
  document.getElementById('extraSheet').classList.remove('open');
}
function clearExtraError() {
  const el = document.getElementById('extraError');
  el.textContent = '';
  el.classList.remove('show');
}
document.getElementById('addExtraBtn').onclick = openExtraSheet;
document.getElementById('extraBackdrop').onclick = closeExtraSheet;
document.getElementById('extraCloseBtn').onclick = closeExtraSheet;

document.getElementById('extraSaveBtn').onclick = async () => {
  const note = document.getElementById('extraNote').value.trim();
  if (!note) {
    const el = document.getElementById('extraError');
    el.textContent = 'Enter what you ate.';
    el.classList.add('show');
    return;
  }
  const ds = dateStr(selectedFoodDate);
  const entry = { id: genId(), date: ds, meal: 'extra', status: 'eaten', note, row: null };
  foodById[entry.id] = entry;
  (foodByDate[ds] = foodByDate[ds] || []).push(entry.id);
  saveLocalFoodCache();
  closeExtraSheet();
  renderFoodDay();
  try {
    const token = await ensureFreshToken();
    if (!token) throw new Error('Sign-in required.');
    const row = await upsertFoodEntry(token, sheetId, entry);
    if (foodById[entry.id] === entry) {
      entry.row = row;
      saveLocalFoodCache();
    } else if (!foodById[entry.id]) {
      clearFoodEntry(token, sheetId, row).catch(() => {});
    }
  } catch (e) {
    showFoodError(`Couldn't save: ${e.message}`);
  }
};

// ---------- Load from Sheet ----------
async function initFood() {
  clearFoodError();
  try {
    const token = await ensureFreshToken();
    if (!token) { showFoodError('Sign-in required to sync.'); return; }
    await ensureTabExists(token, sheetId, FOOD_TAB, FOOD_HEADER);
    const remote = await fetchAllFood(token, sheetId);
    foodById = remote.byId; foodByDate = remote.byDate;
    saveLocalFoodCache();
    renderFoodDay();
  } catch (e) {
    showFoodError(`Couldn't load food log: ${e.message}`);
  }
}

// ---------- Entry point ----------
bootCore(() => {
  document.getElementById('foodPage').style.display = 'flex';
  const cache = loadLocalFoodCache();
  if (cache) { foodById = cache.foodById || {}; foodByDate = cache.foodByDate || {}; }
  renderFoodDay();

  document.getElementById('syncChip').onclick = async () => {
    if (!navigator.onLine) return;
    setSync('busy', 'Syncing…');
    await initFood();
    setSync('ok', 'Synced');
  };

  initFood();
});
