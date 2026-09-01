// expenses.html only: daily/monthly INR expense log, stored in an 'Expenses'
// tab of the same primary spreadsheet the day planner already uses.

const EXPENSE_CACHE_KEY = 'planner_expense_cache';

let expViewMode = 'day'; // 'day' | 'month'
let expSelectedDate = new Date();
let expCurrentMonth, expCurrentYear;
let expensesById = {};
let expensesByDate = {};
let editingExpenseId = null;

function saveLocalExpenseCache() {
  try { localStorage.setItem(EXPENSE_CACHE_KEY, JSON.stringify({ expensesById, expensesByDate })); } catch (e) {}
}
function loadLocalExpenseCache() {
  try { const raw = localStorage.getItem(EXPENSE_CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

function showExpError(msg) {
  const el = document.getElementById('expError');
  el.textContent = msg;
  el.classList.add('show');
}
function clearExpError() {
  const el = document.getElementById('expError');
  el.textContent = '';
  el.classList.remove('show');
}
function showExpSheetError(msg) {
  const el = document.getElementById('expSheetError');
  el.textContent = msg;
  el.classList.add('show');
}
function clearExpSheetError() {
  const el = document.getElementById('expSheetError');
  el.textContent = '';
  el.classList.remove('show');
}

function fmtInr(n) {
  if (!n) return '₹0';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
function dayTotal(ds) {
  const ids = expensesByDate[ds] || [];
  return ids.reduce((sum, id) => sum + ((expensesById[id] && expensesById[id].amount) || 0), 0);
}
function monthTotal(year, month) {
  let total = 0;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) total += dayTotal(dateStr(new Date(year, month, d)));
  return total;
}

// ---------- Daily / Monthly toggle ----------
function setExpModeChrome(mode) {
  document.querySelectorAll('#expViewToggle .seg-btn').forEach(b => b.classList.toggle('selected', b.dataset.mode === mode));
  document.getElementById('expMonthNav').style.display = mode === 'month' ? 'flex' : 'none';
  document.getElementById('expDayNav').style.display = mode === 'day' ? 'flex' : 'none';
  document.getElementById('expMonthView').style.display = mode === 'month' ? 'block' : 'none';
  document.getElementById('expDayView').style.display = mode === 'day' ? 'block' : 'none';
}
function goToExpDay(date) {
  expViewMode = 'day';
  setExpModeChrome('day');
  expSelectedDate = date;
  renderExpDayView();
}
function goToExpMonth() {
  expViewMode = 'month';
  setExpModeChrome('month');
  if (expSelectedDate) { expCurrentMonth = expSelectedDate.getMonth(); expCurrentYear = expSelectedDate.getFullYear(); }
  renderExpMonth();
}
document.querySelectorAll('#expViewToggle .seg-btn').forEach(b => {
  b.onclick = () => { b.dataset.mode === 'day' ? goToExpDay(expSelectedDate || new Date()) : goToExpMonth(); };
});

// ---------- Day view ----------
function renderExpDateNav() {
  const d = expSelectedDate;
  document.getElementById('expDateBanner').innerHTML = `
    <div class="big-num">${d.getDate()}</div>
    <div class="dcol">
      <div class="dow">${DOW_FULL[d.getDay()]}</div>
      <div class="ym">${MONTHS[d.getMonth()]} ${d.getFullYear()}</div>
    </div>`;
}
document.getElementById('expPrevDay').onclick = () => { const d = new Date(expSelectedDate); d.setDate(d.getDate() - 1); goToExpDay(d); };
document.getElementById('expNextDay').onclick = () => { const d = new Date(expSelectedDate); d.setDate(d.getDate() + 1); goToExpDay(d); };

function renderExpDayView() {
  renderExpDateNav();
  const ds = dateStr(expSelectedDate);
  const ids = (expensesByDate[ds] || []).slice().sort((a, b) => (expensesById[a].row || 0) - (expensesById[b].row || 0));
  document.getElementById('expDayTotal').textContent = fmtInr(dayTotal(ds));

  const list = document.getElementById('expList');
  list.innerHTML = '';
  if (ids.length === 0) {
    list.innerHTML = '<div class="empty-state">No expenses logged for this day.</div>';
    return;
  }
  ids.forEach(id => {
    const e = expensesById[id];
    const row = document.createElement('div');
    row.className = 'exp-row';
    row.innerHTML = `<div class="exp-row-main"><span class="exp-amt">${fmtInr(e.amount)}</span><span class="exp-reason">${escapeHtml(e.reason)}</span></div>`;
    row.onclick = () => openExpenseSheet(e);
    list.appendChild(row);
  });
}

// ---------- Month view (price-under-date, like a flight-search calendar) ----------
function renderExpMonth(direction) {
  document.getElementById('expMonthLabel').textContent = `${MONTHS[expCurrentMonth]} ${expCurrentYear}`;
  document.getElementById('expMonthTotal').textContent = `Total this month: ${fmtInr(monthTotal(expCurrentYear, expCurrentMonth))}`;
  const grid = document.getElementById('expMonthGrid');
  grid.innerHTML = '';
  const first = new Date(expCurrentYear, expCurrentMonth, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(expCurrentYear, expCurrentMonth + 1, 0).getDate();
  const todayStr = dateStr(new Date());
  for (let i = 0; i < startOffset; i++) { const b = document.createElement('div'); b.className = 'exp-cell blank'; grid.appendChild(b); }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(expCurrentYear, expCurrentMonth, d);
    const ds = dateStr(date);
    const total = dayTotal(ds);
    const cell = document.createElement('div');
    cell.className = 'exp-cell' + (ds === todayStr ? ' today' : '') + (total > 0 ? ' has-spend' : '');
    cell.innerHTML = `<div class="dnum">${d}</div><div class="exp-price">${total > 0 ? fmtInr(total) : ''}</div>`;
    cell.onclick = () => goToExpDay(date);
    grid.appendChild(cell);
  }
  if (direction) {
    grid.classList.remove('anim-next', 'anim-prev');
    void grid.offsetWidth;
    grid.classList.add(direction === 'next' ? 'anim-next' : 'anim-prev');
  }
}
document.getElementById('expPrevMonth').onclick = () => { expCurrentMonth--; if (expCurrentMonth < 0) { expCurrentMonth = 11; expCurrentYear--; } renderExpMonth('prev'); };
document.getElementById('expNextMonth').onclick = () => { expCurrentMonth++; if (expCurrentMonth > 11) { expCurrentMonth = 0; expCurrentYear++; } renderExpMonth('next'); };

// ---------- Add/edit sheet ----------
function openExpenseSheet(e) {
  editingExpenseId = e ? e.id : null;
  clearExpSheetError();
  document.getElementById('expAmount').value = e ? e.amount : '';
  document.getElementById('expReason').value = e ? e.reason : '';
  document.getElementById('expDeleteBtn').style.display = e ? 'block' : 'none';
  document.getElementById('expBackdrop').classList.add('open');
  document.getElementById('expSheet').classList.add('open');
  setTimeout(() => document.getElementById('expAmount').focus(), 200);
}
function closeExpenseSheet() {
  document.getElementById('expBackdrop').classList.remove('open');
  document.getElementById('expSheet').classList.remove('open');
  editingExpenseId = null;
}
document.getElementById('addExpenseBtn').onclick = () => openExpenseSheet(null);
document.getElementById('expBackdrop').onclick = closeExpenseSheet;
document.getElementById('expCloseBtn').onclick = closeExpenseSheet;

document.getElementById('expSaveBtn').onclick = async () => {
  const amount = parseFloat(document.getElementById('expAmount').value);
  const reason = document.getElementById('expReason').value.trim();
  if (!amount || amount <= 0) { showExpSheetError('Enter a valid amount.'); return; }
  if (!reason) { showExpSheetError('Enter a short reason.'); return; }
  clearExpSheetError();

  const ds = dateStr(expSelectedDate);
  const existingRow = editingExpenseId && expensesById[editingExpenseId] ? expensesById[editingExpenseId].row : null;
  const entry = { id: editingExpenseId || genId(), date: ds, amount, reason, row: existingRow };

  expensesById[entry.id] = entry;
  if (!editingExpenseId) (expensesByDate[ds] = expensesByDate[ds] || []).push(entry.id);
  saveLocalExpenseCache();

  closeExpenseSheet();
  if (expViewMode === 'day') renderExpDayView(); else renderExpMonth();

  try {
    const token = await ensureFreshToken();
    if (!token) throw new Error('Sign-in required.');
    if (entry.row) {
      await updateExpense(token, sheetId, entry.row, entry);
    } else {
      const row = await appendExpense(token, sheetId, entry);
      // If this entry was deleted locally while the append was still in
      // flight, it's now an orphaned row on the server — clean it up instead
      // of recording its row number on a no-longer-tracked entry.
      if (expensesById[entry.id] === entry) {
        entry.row = row;
        saveLocalExpenseCache();
      } else if (!expensesById[entry.id]) {
        clearExpense(token, sheetId, row).catch(() => {});
      }
    }
  } catch (e) {
    showExpError(`Couldn't save: ${e.message}`);
  }
};

document.getElementById('expDeleteBtn').onclick = async () => {
  if (!editingExpenseId || !expensesById[editingExpenseId]) { closeExpenseSheet(); return; }
  const e = expensesById[editingExpenseId];
  const ds = e.date;
  expensesByDate[ds] = (expensesByDate[ds] || []).filter(id => id !== editingExpenseId);
  delete expensesById[editingExpenseId];
  saveLocalExpenseCache();

  closeExpenseSheet();
  if (expViewMode === 'day') renderExpDayView(); else renderExpMonth();

  if (e.row) {
    try {
      const token = await ensureFreshToken();
      if (token) await clearExpense(token, sheetId, e.row);
    } catch (err) { showExpError(`Couldn't delete: ${err.message}`); }
  }
};

// ---------- Load from Sheet ----------
async function initExpenses() {
  clearExpError();
  try {
    const token = await ensureFreshToken();
    if (!token) { showExpError('Sign-in required to sync.'); return; }
    await ensureTabExists(token, sheetId, EXPENSE_TAB, EXPENSE_HEADER);
    const remote = await fetchAllExpenses(token, sheetId);
    expensesById = remote.byId; expensesByDate = remote.byDate;
    saveLocalExpenseCache();
    if (expViewMode === 'day') renderExpDayView(); else renderExpMonth();
  } catch (e) {
    showExpError(`Couldn't load expenses: ${e.message}`);
  }
}

// ---------- Entry point ----------
bootCore(() => {
  document.getElementById('expPage').style.display = 'flex';
  const cache = loadLocalExpenseCache();
  if (cache) { expensesById = cache.expensesById || {}; expensesByDate = cache.expensesByDate || {}; }

  const now = new Date();
  expCurrentMonth = now.getMonth(); expCurrentYear = now.getFullYear();
  goToExpDay(now);

  document.getElementById('syncChip').onclick = async () => {
    if (!navigator.onLine) return;
    setSync('busy', 'Syncing…');
    await initExpenses();
    setSync('ok', 'Synced');
  };

  initExpenses();
});
