// All reads/writes go straight to the Google Sheets API + Drive API over fetch.
// No client library, no backend — the Sheet IS the backend.

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

async function apiFetch(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Sheets/Drive API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

const SHEET_HEADER = [['ID', 'Date', 'Start', 'End', 'Title', 'Category', 'Notes']];

// Finds (or creates) one role's sheet: 'primary', 'backup1', or 'backup2'.
// Installs that predate the backup feature only ever created a single sheet
// tagged plannerApp=v1 with no role — that one gets adopted as 'primary'
// instead of creating a duplicate.
async function findOrCreateOneSheet(token, role, storageKey, titleSuffix) {
  const cached = localStorage.getItem(storageKey);
  if (cached && !navigator.onLine) return cached;
  if (cached) {
    try {
      await apiFetch(`${SHEETS_API}/${cached}?fields=spreadsheetId`, token);
      return cached;
    } catch (e) {
      localStorage.removeItem(storageKey);
    }
  }

  const q = encodeURIComponent(`appProperties has { key='plannerRole' and value='${role}' } and trashed=false`);
  const list = await apiFetch(`${DRIVE_API}?q=${q}&fields=files(id,name)`, token);
  if (list.files && list.files.length) {
    localStorage.setItem(storageKey, list.files[0].id);
    return list.files[0].id;
  }

  if (role === 'primary') {
    const legacyQ = encodeURIComponent(`appProperties has { key='plannerApp' and value='v1' } and not appProperties has { key='plannerRole' } and trashed=false`);
    try {
      const legacy = await apiFetch(`${DRIVE_API}?q=${legacyQ}&fields=files(id,name)`, token);
      if (legacy.files && legacy.files.length) {
        const id = legacy.files[0].id;
        await apiFetch(`${DRIVE_API}/${id}`, token, { method: 'PATCH', body: JSON.stringify({ appProperties: { plannerApp: 'v1', plannerRole: role } }) });
        localStorage.setItem(storageKey, id);
        return id;
      }
    } catch (e) { /* fall through to creating a fresh sheet */ }
  }

  const created = await apiFetch(DRIVE_API, token, {
    method: 'POST',
    body: JSON.stringify({
      name: CONFIG.SHEET_TITLE + titleSuffix,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      appProperties: { plannerApp: 'v1', plannerRole: role },
    }),
  });
  const id = created.id;
  await apiFetch(
    `${SHEETS_API}/${id}/values/${CONFIG.SHEET_TAB}!A1:G1?valueInputOption=RAW`,
    token,
    { method: 'PUT', body: JSON.stringify({ values: SHEET_HEADER }) }
  );
  localStorage.setItem(storageKey, id);
  return id;
}

// Ensures the primary sheet and both backup mirrors all exist, creating
// whichever ones are missing (used on first sign-in, or to backfill backups
// for installs that predate this feature).
async function findOrCreateAllSheets(token) {
  const primary = await findOrCreateOneSheet(token, 'primary', 'planner_sheet_id', '');
  const backup1 = await findOrCreateOneSheet(token, 'backup1', 'planner_backup1_id', ' (Backup 1)');
  const backup2 = await findOrCreateOneSheet(token, 'backup2', 'planner_backup2_id', ' (Backup 2)');
  return { primary, backup1, backup2 };
}

// Overwrites a backup sheet entirely with the current full task list — a
// periodic full-mirror snapshot rather than per-edit replication, so it can
// never drift out of sync from a partial failure on one of three writes.
async function mirrorTasksToSheet(token, sheetId, tasksByIdObj) {
  const rows = Object.values(tasksByIdObj)
    .sort((a, b) => (a.date === b.date ? a.startMin - b.startMin : (a.date < b.date ? -1 : 1)))
    .map(t => [t.id, t.date, t.startMin, t.endMin, t.title, t.cat, t.notes]);
  await apiFetch(`${SHEETS_API}/${sheetId}/values/${CONFIG.SHEET_TAB}!A1:G200000:clear`, token, { method: 'POST' });
  await apiFetch(
    `${SHEETS_API}/${sheetId}/values/${CONFIG.SHEET_TAB}!A1?valueInputOption=RAW`,
    token,
    { method: 'PUT', body: JSON.stringify({ values: SHEET_HEADER.concat(rows) }) }
  );
}

// Loads every task row and indexes it by id and by date for fast rendering.
async function fetchAllTasks(token, sheetId) {
  const data = await apiFetch(`${SHEETS_API}/${sheetId}/values/${CONFIG.SHEET_TAB}!A2:G200000`, token);
  const rows = data.values || [];
  const tasksById = {};
  const tasksByDate = {};
  rows.forEach((row, i) => {
    const [id, date, start, end, title, cat, notes] = row;
    if (!id) return; // blank = soft-deleted row
    const task = {
      id, date, startMin: parseInt(start, 10), endMin: parseInt(end, 10),
      title, cat, notes: notes || '', row: i + 2,
    };
    tasksById[id] = task;
    (tasksByDate[date] = tasksByDate[date] || []).push(id);
  });
  return { tasksById, tasksByDate };
}

async function appendTask(token, sheetId, task) {
  const res = await apiFetch(
    `${SHEETS_API}/${sheetId}/values/${CONFIG.SHEET_TAB}!A:G:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    token,
    { method: 'POST', body: JSON.stringify({ values: [[task.id, task.date, task.startMin, task.endMin, task.title, task.cat, task.notes]] }) }
  );
  const match = res.updates.updatedRange.match(/![A-Z]+(\d+)/);
  return parseInt(match[1], 10);
}

// Appends several new task rows in a single API call (used by the long-press
// multi-slot "apply same task to N slots" feature).
async function appendTasksBulk(token, sheetId, tasks) {
  const values = tasks.map(t => [t.id, t.date, t.startMin, t.endMin, t.title, t.cat, t.notes]);
  const res = await apiFetch(
    `${SHEETS_API}/${sheetId}/values/${CONFIG.SHEET_TAB}!A:G:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    token,
    { method: 'POST', body: JSON.stringify({ values }) }
  );
  const match = res.updates.updatedRange.match(/![A-Z]+(\d+):/);
  const startRow = parseInt(match[1], 10);
  return tasks.map((_, i) => startRow + i);
}

async function updateTaskRow(token, sheetId, row, task) {
  await apiFetch(
    `${SHEETS_API}/${sheetId}/values/${CONFIG.SHEET_TAB}!A${row}:G${row}?valueInputOption=RAW`,
    token,
    { method: 'PUT', body: JSON.stringify({ values: [[task.id, task.date, task.startMin, task.endMin, task.title, task.cat, task.notes]] }) }
  );
}

async function clearTaskRow(token, sheetId, row) {
  await apiFetch(
    `${SHEETS_API}/${sheetId}/values/${CONFIG.SHEET_TAB}!A${row}:G${row}:clear`,
    token,
    { method: 'POST' }
  );
}

// ---------- Food + Expenses: extra tabs in the same spreadsheet ----------
// The primary spreadsheet only ever has 'Sheet1' (planner tasks) at first —
// Food and Expenses get their own tab, created lazily the first time each
// feature actually loads, instead of every install paying for tabs it never uses.
async function ensureTabExists(token, sheetId, tabName, header) {
  const meta = await apiFetch(`${SHEETS_API}/${sheetId}?fields=sheets.properties.title`, token);
  const exists = (meta.sheets || []).some(s => s.properties.title === tabName);
  if (exists) return;
  await apiFetch(`${SHEETS_API}/${sheetId}:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }),
  });
  await apiFetch(`${SHEETS_API}/${sheetId}/values/${tabName}!A1?valueInputOption=RAW`, token, {
    method: 'PUT', body: JSON.stringify({ values: [header] }),
  });
}

// ---------- Food tracking ('Food' tab) ----------
const FOOD_TAB = 'Food';
const FOOD_HEADER = ['ID', 'Date', 'Meal', 'Status', 'Note'];

async function fetchAllFood(token, sheetId) {
  const data = await apiFetch(`${SHEETS_API}/${sheetId}/values/${FOOD_TAB}!A2:E200000`, token);
  const rows = data.values || [];
  const byId = {}, byDate = {};
  rows.forEach((row, i) => {
    const [id, date, meal, status, note] = row;
    if (!id) return; // blank = soft-deleted row
    const e = { id, date, meal, status: status || '', note: note || '', row: i + 2 };
    byId[id] = e;
    (byDate[date] = byDate[date] || []).push(id);
  });
  return { byId, byDate };
}

// Upserts by row: a brand-new entry (row===null) is appended, an existing one
// is overwritten in place — the caller decides which by whether it already
// knows a row number.
async function upsertFoodEntry(token, sheetId, e) {
  if (e.row) {
    await apiFetch(`${SHEETS_API}/${sheetId}/values/${FOOD_TAB}!A${e.row}:E${e.row}?valueInputOption=RAW`, token,
      { method: 'PUT', body: JSON.stringify({ values: [[e.id, e.date, e.meal, e.status, e.note]] }) });
    return e.row;
  }
  const res = await apiFetch(`${SHEETS_API}/${sheetId}/values/${FOOD_TAB}!A:E:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, token,
    { method: 'POST', body: JSON.stringify({ values: [[e.id, e.date, e.meal, e.status, e.note]] }) });
  const match = res.updates.updatedRange.match(/![A-Z]+(\d+)/);
  return parseInt(match[1], 10);
}

async function clearFoodEntry(token, sheetId, row) {
  await apiFetch(`${SHEETS_API}/${sheetId}/values/${FOOD_TAB}!A${row}:E${row}:clear`, token, { method: 'POST' });
}

// ---------- Expense tracking ('Expenses' tab) ----------
const EXPENSE_TAB = 'Expenses';
const EXPENSE_HEADER = ['ID', 'Date', 'Amount', 'Reason'];

async function fetchAllExpenses(token, sheetId) {
  const data = await apiFetch(`${SHEETS_API}/${sheetId}/values/${EXPENSE_TAB}!A2:D200000`, token);
  const rows = data.values || [];
  const byId = {}, byDate = {};
  rows.forEach((row, i) => {
    const [id, date, amount, reason] = row;
    if (!id) return;
    const e = { id, date, amount: parseFloat(amount) || 0, reason: reason || '', row: i + 2 };
    byId[id] = e;
    (byDate[date] = byDate[date] || []).push(id);
  });
  return { byId, byDate };
}

async function appendExpense(token, sheetId, e) {
  const res = await apiFetch(`${SHEETS_API}/${sheetId}/values/${EXPENSE_TAB}!A:D:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, token,
    { method: 'POST', body: JSON.stringify({ values: [[e.id, e.date, e.amount, e.reason]] }) });
  const match = res.updates.updatedRange.match(/![A-Z]+(\d+)/);
  return parseInt(match[1], 10);
}

async function updateExpense(token, sheetId, row, e) {
  await apiFetch(`${SHEETS_API}/${sheetId}/values/${EXPENSE_TAB}!A${row}:D${row}?valueInputOption=RAW`, token,
    { method: 'PUT', body: JSON.stringify({ values: [[e.id, e.date, e.amount, e.reason]] }) });
}

async function clearExpense(token, sheetId, row) {
  await apiFetch(`${SHEETS_API}/${sheetId}/values/${EXPENSE_TAB}!A${row}:D${row}:clear`, token, { method: 'POST' });
}
