// tasks.html only: Google Tasks list management (separate Google feature
// from the planner's own Sheet-backed tasks — same OAuth session, different
// API and different data).

let taskLists = [];
let currentListId = null;
let currentListTasks = [];
let showCompleted = false;
let editingTaskId = null; // null while adding a brand-new task

function onDataRefreshed() { /* planner-sheet sync; unrelated to Google Tasks */ }

function showTasksError(msg) {
  const el = document.getElementById('tasksError');
  el.textContent = msg;
  el.classList.add('show');
}
function clearTasksError() {
  const el = document.getElementById('tasksError');
  el.textContent = '';
  el.classList.remove('show');
}

// A cached token from before this feature existed (or before this account
// ever granted it) won't carry Tasks scope — a cheap probe call catches that.
// Silent-only: never pops the interactive consent screen itself, so it's
// safe to call from page load, not just from a click.
async function probeTasksToken() {
  const token = await ensureFreshToken();
  if (!token) return null;
  try {
    await tasksFetch(`${TASKS_API}/users/@me/lists?maxResults=1`, token);
    return token;
  } catch (e) {
    if (e.status === 401 || e.status === 403) return null;
    throw e;
  }
}

// For click-triggered actions only (add/edit/delete/toggle/etc.) — safe to
// pop the interactive consent screen here since a real user gesture is on
// the call stack. Popping it from an unprompted page load instead would get
// blocked by the browser as an unwanted popup, so initial boot uses the
// "Grant access" button (below) rather than this.
async function ensureTasksToken() {
  const token = await probeTasksToken();
  if (token) return token;
  return new Promise((resolve) => signInInteractive((ok) => resolve(ok ? accessToken : null)));
}

function fmtDueDate(due) {
  const d = new Date(due);
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;
}

// ---------- List selector ----------
function renderListSelector() {
  const sel = document.getElementById('taskListSelect');
  sel.innerHTML = '';
  taskLists.forEach((l) => {
    const opt = document.createElement('option');
    opt.value = l.id; opt.textContent = l.title;
    sel.appendChild(opt);
  });
  sel.value = currentListId;
}
document.getElementById('taskListSelect').onchange = async (e) => {
  currentListId = e.target.value;
  localStorage.setItem('planner_last_tasklist', currentListId);
  await loadCurrentListTasks();
};

document.getElementById('newListBtn').onclick = () => {
  const row = document.getElementById('newListRow');
  row.classList.toggle('open');
  if (row.classList.contains('open')) document.getElementById('newListName').focus();
};
document.getElementById('newListCreateBtn').onclick = async () => {
  const nameI = document.getElementById('newListName');
  const title = nameI.value.trim();
  if (!title) return;
  clearTasksError();
  try {
    const token = await ensureTasksToken();
    if (!token) { showTasksError('Sign-in required.'); return; }
    const created = await createTaskList(token, title);
    taskLists.push(created);
    currentListId = created.id;
    localStorage.setItem('planner_last_tasklist', currentListId);
    nameI.value = '';
    document.getElementById('newListRow').classList.remove('open');
    renderListSelector();
    await loadCurrentListTasks();
  } catch (e) {
    showTasksError(`Couldn't create list: ${e.message}`);
  }
};

// ---------- Task list rendering ----------
async function loadCurrentListTasks() {
  clearTasksError();
  document.getElementById('tasksLoading').style.display = 'block';
  document.getElementById('taskItems').innerHTML = '';
  try {
    const token = await ensureTasksToken();
    if (!token) { showTasksError('Sign-in required.'); return; }
    currentListTasks = await listTasks(token, currentListId, showCompleted);
    renderTasks();
  } catch (e) {
    showTasksError(`Couldn't load tasks: ${e.message}`);
  } finally {
    document.getElementById('tasksLoading').style.display = 'none';
  }
}

function renderTasks() {
  const listEl = document.getElementById('taskItems');
  listEl.innerHTML = '';
  const pending = currentListTasks.filter((t) => t.status !== 'completed');
  const done = currentListTasks.filter((t) => t.status === 'completed');
  const ordered = showCompleted ? pending.concat(done) : pending;
  if (ordered.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No tasks yet. Tap + to add one.</div>';
    return;
  }
  ordered.forEach((t) => listEl.appendChild(renderTaskRow(t)));
}

function renderTaskRow(t) {
  const row = document.createElement('div');
  row.className = 'gtask-row' + (t.status === 'completed' ? ' done' : '');
  const dueBadge = t.due ? `<span class="gtask-due">${fmtDueDate(t.due)}</span>` : '';
  row.innerHTML = `
    <button class="gtask-check" type="button" aria-label="Toggle complete"></button>
    <div class="gtask-body">
      <div class="gtask-title">${escapeHtml(t.title || '(untitled)')}</div>
      ${t.notes ? `<div class="gtask-notes">${escapeHtml(t.notes.slice(0, 140))}</div>` : ''}
    </div>
    ${dueBadge}`;
  row.querySelector('.gtask-check').onclick = (e) => { e.stopPropagation(); toggleTaskComplete(t); };
  row.onclick = () => openTaskSheet(t);
  return row;
}

async function toggleTaskComplete(t) {
  const prevStatus = t.status;
  t.status = prevStatus === 'completed' ? 'needsAction' : 'completed';
  renderTasks();
  try {
    const token = await ensureTasksToken();
    if (!token) throw new Error('Sign-in required.');
    await patchTask(token, currentListId, t.id, {
      status: t.status,
      completed: t.status === 'completed' ? new Date().toISOString() : null,
    });
  } catch (e) {
    t.status = prevStatus;
    renderTasks();
    showTasksError(`Couldn't update task: ${e.message}`);
  }
}

document.getElementById('showCompletedToggle').onchange = (e) => {
  showCompleted = e.target.checked;
  loadCurrentListTasks();
};
document.getElementById('clearCompletedBtn').onclick = async () => {
  clearTasksError();
  try {
    const token = await ensureTasksToken();
    if (!token) { showTasksError('Sign-in required.'); return; }
    await clearCompletedTasks(token, currentListId);
    await loadCurrentListTasks();
  } catch (e) {
    showTasksError(`Couldn't clear completed tasks: ${e.message}`);
  }
};

// ---------- Task editor sheet ----------
function openTaskSheet(t) {
  editingTaskId = t ? t.id : null;
  clearGtaskError();
  document.getElementById('gtaskTitle').value = t ? (t.title || '') : '';
  document.getElementById('gtaskNotes').value = t ? (t.notes || '') : '';
  document.getElementById('gtaskDue').value = t && t.due ? t.due.slice(0, 10) : '';
  document.getElementById('gtaskDeleteBtn').style.display = t ? 'block' : 'none';
  document.getElementById('gtaskBackdrop').classList.add('open');
  document.getElementById('gtaskSheet').classList.add('open');
  setTimeout(() => document.getElementById('gtaskTitle').focus(), 200);
}
function closeTaskSheet() {
  document.getElementById('gtaskBackdrop').classList.remove('open');
  document.getElementById('gtaskSheet').classList.remove('open');
  editingTaskId = null;
}
function clearGtaskError() {
  const el = document.getElementById('gtaskError');
  el.textContent = '';
  el.classList.remove('show');
}
document.getElementById('gtaskBackdrop').onclick = closeTaskSheet;
document.getElementById('gtaskCloseBtn').onclick = closeTaskSheet;
document.getElementById('addTaskBtn').onclick = () => openTaskSheet(null);

document.getElementById('gtaskSaveBtn').onclick = async () => {
  const title = document.getElementById('gtaskTitle').value.trim();
  if (!title) {
    const el = document.getElementById('gtaskError');
    el.textContent = 'Title is required.';
    el.classList.add('show');
    return;
  }
  const notes = document.getElementById('gtaskNotes').value.trim();
  const dueStr = document.getElementById('gtaskDue').value;
  const due = dueStr ? new Date(dueStr + 'T00:00:00.000Z').toISOString() : null;
  const btn = document.getElementById('gtaskSaveBtn');
  btn.disabled = true;
  try {
    const token = await ensureTasksToken();
    if (!token) throw new Error('Sign-in required.');
    if (editingTaskId) await patchTask(token, currentListId, editingTaskId, { title, notes, due });
    else await insertTask(token, currentListId, { title, notes, due });
    closeTaskSheet();
    await loadCurrentListTasks();
  } catch (e) {
    const el = document.getElementById('gtaskError');
    el.textContent = e.message;
    el.classList.add('show');
  } finally {
    btn.disabled = false;
  }
};

document.getElementById('gtaskDeleteBtn').onclick = async () => {
  if (!editingTaskId) return;
  try {
    const token = await ensureTasksToken();
    if (!token) throw new Error('Sign-in required.');
    await deleteTask(token, currentListId, editingTaskId);
    closeTaskSheet();
    await loadCurrentListTasks();
  } catch (e) {
    const el = document.getElementById('gtaskError');
    el.textContent = e.message;
    el.classList.add('show');
  }
};

// ---------- Entry point ----------
async function loadTaskListsAndTasks(token) {
  taskLists = await listTaskLists(token);
  if (taskLists.length === 0) taskLists = [await createTaskList(token, 'My Tasks')];
  const savedListId = localStorage.getItem('planner_last_tasklist');
  currentListId = (taskLists.find((l) => l.id === savedListId) || taskLists[0]).id;
  renderListSelector();
  await loadCurrentListTasks();
}

async function initTasksFeature() {
  clearTasksError();
  document.getElementById('tasksGrantPanel').style.display = 'none';
  document.getElementById('tasksLoading').style.display = 'block';
  try {
    const token = await probeTasksToken();
    if (!token) { document.getElementById('tasksGrantPanel').style.display = 'block'; return; }
    await loadTaskListsAndTasks(token);
  } catch (e) {
    showTasksError(`Couldn't load Google Tasks: ${e.message}`);
  } finally {
    document.getElementById('tasksLoading').style.display = 'none';
  }
}

document.getElementById('grantTasksBtn').onclick = () => {
  clearTasksError();
  signInInteractive((ok) => {
    if (ok) initTasksFeature();
    else showTasksError("Couldn't get permission. Try again.");
  });
};

bootCore(() => {
  document.getElementById('tasksPage').style.display = 'flex';
  // The shared sync chip normally re-pulls the planner's Sheet data, which
  // has nothing to do with this page — point it at refreshing Tasks instead.
  document.getElementById('syncChip').onclick = async () => {
    if (!navigator.onLine) return;
    setSync('busy', 'Syncing…');
    await initTasksFeature();
    setSync('ok', 'Synced');
  };
  initTasksFeature();
});
