// index.html only: month/day rendering, the task editor sheet, and long-press
// multi-select. Everything shared (boot, sync, theme, drawer) lives in core.js.

let currentMonth, currentYear;
let selectedDate = null;
let viewMode = 'day'; // 'day' | 'month'
let editingId = null;
let watchedTodayStr = null;

// ---------- Multi-select (long-press) state ----------
let multiSelectMode = false;
let selectedSlots = new Set(); // slot indices (30-min units from midnight)
let sheetMode = 'single'; // 'single' | 'bulk'

function onDataRefreshed() {
  if (viewMode === 'day') renderTimeline();
  else if (viewMode === 'month') renderMonth();
}

// ---------- Keep "today" true to the real date while the app stays open ----------
function startDateWatcher() {
  setInterval(checkDateRollover, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDateRollover(); });
}
function checkDateRollover() {
  const nowStr = dateStr(new Date());
  if (nowStr === watchedTodayStr) return;
  const wasViewingOldToday = viewMode === 'day' && selectedDate && dateStr(selectedDate) === watchedTodayStr;
  watchedTodayStr = nowStr;
  if (wasViewingOldToday) goToDay(new Date());
  else if (viewMode === 'month') renderMonth();
}

// ---------- Daily / Monthly toggle ----------
function setModeChrome(mode) {
  document.querySelectorAll('#viewToggle .seg-btn').forEach(b => b.classList.toggle('selected', b.dataset.mode === mode));
  document.getElementById('monthNav').style.display = mode === 'month' ? 'flex' : 'none';
  document.getElementById('dayNav').style.display = mode === 'day' ? 'flex' : 'none';
  document.getElementById('monthView').style.display = mode === 'month' ? 'block' : 'none';
  document.getElementById('dayView').style.display = mode === 'day' ? 'flex' : 'none';
}

function playViewEntrance(containerId) {
  const el = document.getElementById(containerId);
  el.classList.remove('view-fade-in');
  void el.offsetWidth;
  el.classList.add('view-fade-in');
}

function goToDay(date) {
  viewMode = 'day';
  exitMultiSelect();
  setModeChrome('day');
  selectedDate = date;
  renderDateNav(date);
  renderTimeline();
  playViewEntrance('dayView');
}

function goToMonth() {
  viewMode = 'month';
  exitMultiSelect();
  setModeChrome('month');
  if (selectedDate) { currentMonth = selectedDate.getMonth(); currentYear = selectedDate.getFullYear(); }
  renderMonth();
  playViewEntrance('monthView');
}

document.querySelectorAll('#viewToggle .seg-btn').forEach(b => {
  b.onclick = () => { b.dataset.mode === 'day' ? goToDay(selectedDate || new Date()) : goToMonth(); };
});

function renderDateNav(date) {
  document.getElementById('dateBanner').innerHTML = `
    <div class="big-num">${date.getDate()}</div>
    <div class="dcol">
      <div class="dow">${DOW_FULL[date.getDay()]}</div>
      <div class="ym">${MONTHS[date.getMonth()]} ${date.getFullYear()}</div>
    </div>`;
}
document.getElementById('prevDay').onclick = () => { const d = new Date(selectedDate); d.setDate(d.getDate() - 1); goToDay(d); };
document.getElementById('nextDay').onclick = () => { const d = new Date(selectedDate); d.setDate(d.getDate() + 1); goToDay(d); };

// ---------- Month view ----------
function renderMonth(direction) {
  document.getElementById('monthLabel').textContent = `${MONTHS[currentMonth]} ${currentYear}`;
  const grid = document.getElementById('monthGrid');
  grid.innerHTML = '';
  const first = new Date(currentYear, currentMonth, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const todayStr = dateStr(new Date());
  for (let i = 0; i < startOffset; i++) { const b = document.createElement('div'); b.className = 'cell blank'; grid.appendChild(b); }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(currentYear, currentMonth, d);
    const ds = dateStr(date);
    const cell = document.createElement('div');
    cell.className = 'cell' + (ds === todayStr ? ' today' : '');
    const ids = tasksByDate[ds] || [];
    const cats = new Set(ids.map(id => tasksById[id].cat));
    cell.innerHTML = `<div class="dnum">${d}</div><div class="dots">${[...cats].slice(0, 3).map(c => `<div class="dot" style="background:${CAT_MAP[c] ? CAT_MAP[c].color : '#666'}"></div>`).join('')}</div>`;
    cell.onclick = () => goToDay(date);
    grid.appendChild(cell);
  }
  if (direction) {
    grid.classList.remove('anim-next', 'anim-prev');
    void grid.offsetWidth;
    grid.classList.add(direction === 'next' ? 'anim-next' : 'anim-prev');
  }
}
document.getElementById('prevMonth').onclick = () => { currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; } renderMonth('prev'); };
document.getElementById('nextMonth').onclick = () => { currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; } renderMonth('next'); };

// ---------- Day view / timeline ----------
function timeToSlotIndex(m) { return Math.floor(m / 30); }

function currentDayData() {
  const ds = dateStr(selectedDate);
  const out = {};
  (tasksByDate[ds] || []).forEach(id => { out[id] = tasksById[id]; });
  return out;
}

// ---------- Long-press multi-select on empty slots ----------
function exitMultiSelect() {
  multiSelectMode = false;
  selectedSlots.clear();
  document.getElementById('multiBar').classList.remove('open');
}
function updateMultiBar() {
  const bar = document.getElementById('multiBar');
  document.getElementById('multiCount').textContent = `${selectedSlots.size} selected`;
  bar.classList.add('open');
}
// Mutates the tapped slot's own DOM element directly rather than calling
// renderTimeline() — a full rebuild mid-gesture destroys the element the
// finger is still touching, so the browser re-targets pointerup at a fresh
// (untouched) replacement and the selection immediately toggles back off.
function toggleSlotSelection(idx, el) {
  if (selectedSlots.has(idx)) selectedSlots.delete(idx); else selectedSlots.add(idx);
  if (el) el.classList.toggle('selected', selectedSlots.has(idx));
  if (selectedSlots.size === 0) { exitMultiSelect(); renderTimeline(); return; }
  updateMultiBar();
}
function enterOrToggleMultiSelect(idx, el) {
  if (!multiSelectMode) {
    multiSelectMode = true;
    selectedSlots.clear();
  }
  toggleSlotSelection(idx, el);
}
document.getElementById('multiCancelBtn').onclick = () => { exitMultiSelect(); renderTimeline(); };
document.getElementById('multiApplyBtn').onclick = () => { if (selectedSlots.size > 0) openBulkSheet(); };

function attachEmptySlotHandlers(el, idx) {
  let timer = null, fired = false, startX = 0, startY = 0;
  const LONG_PRESS_MS = 450, MOVE_TOLERANCE = 10;
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    fired = false;
    startX = e.clientX; startY = e.clientY;
    el.classList.add('pressing');
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    timer = setTimeout(() => { fired = true; el.classList.remove('pressing'); enterOrToggleMultiSelect(idx, el); }, LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', (e) => {
    if (!timer) return;
    if (Math.abs(e.clientX - startX) > MOVE_TOLERANCE || Math.abs(e.clientY - startY) > MOVE_TOLERANCE) {
      clearTimeout(timer); timer = null; el.classList.remove('pressing');
    }
  });
  const cancel = () => { clearTimeout(timer); timer = null; el.classList.remove('pressing'); };
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerup', () => {
    cancel();
    if (fired) return; // long-press already handled the selection
    if (multiSelectMode) toggleSlotSelection(idx, el);
    else openSheet(null, idx * 30);
  });
}

function renderTimeline() {
  const timeline = document.getElementById('timeline');
  timeline.innerHTML = '';
  const currentData = currentDayData();
  const occupied = new Set(); const slotTask = {};
  Object.entries(currentData).forEach(([id, t]) => {
    const s = timeToSlotIndex(t.startMin), e = timeToSlotIndex(t.endMin);
    slotTask[s] = id; for (let i = s; i < e; i++) occupied.add(i);
  });
  let taskIndex = 0;
  for (let h = 0; h < 24; h++) {
    const row = document.createElement('div'); row.className = 'hour-row';
    row.innerHTML = `<div class="hour-label">${fmtHourLabel(h)}</div>`;
    const slotsDiv = document.createElement('div'); slotsDiv.className = 'slots';
    for (let half = 0; half < 2; half++) {
      const idx = h * 2 + half;
      if (occupied.has(idx) && !slotTask[idx]) continue;
      if (slotTask[idx]) {
        const id = slotTask[idx]; const t = currentData[id];
        const span = timeToSlotIndex(t.endMin) - timeToSlotIndex(t.startMin);
        const block = document.createElement('div'); block.className = 'slot'; block.style.minHeight = (span * 28) + 'px';
        const cat = CAT_MAP[t.cat] || CATEGORIES[0];
        const hasTitle = !!(t.title && t.title.trim());
        const headline = hasTitle ? escapeHtml(t.title) : cat.label;
        const metaBits = [`${fmtTime(t.startMin)}&ndash;${fmtTime(t.endMin)}`];
        if (hasTitle) metaBits.push(cat.label); // headline already IS the category when there's no title
        if (t.notes) metaBits.push(escapeHtml(t.notes.slice(0, 30)));
        block.innerHTML = `<div class="task-block" style="--cat-color:${cat.color}; animation-delay:${Math.min(taskIndex * 35, 300)}ms;">
          <div class="t-title">${headline}</div>
          <div class="t-meta"><span class="cat-dot"></span>${metaBits.join(' &middot; ')}</div></div>`;
        block.onclick = () => openSheet(id);
        slotsDiv.appendChild(block);
        taskIndex++;
      } else {
        const empty = document.createElement('div');
        empty.className = 'slot empty' + (selectedSlots.has(idx) ? ' selected' : '');
        attachEmptySlotHandlers(empty, idx);
        slotsDiv.appendChild(empty);
      }
    }
    row.appendChild(slotsDiv);
    timeline.appendChild(row);
  }
  if (Object.keys(currentData).length === 0 && selectedSlots.size === 0) {
    const e = document.createElement('div'); e.className = 'empty-state'; e.textContent = 'Nothing planned. Tap a slot to add, or press and hold to select several.';
    timeline.prepend(e);
  }
}

function populateTimeSelects() {
  const s = document.getElementById('startTime'), e = document.getElementById('endTime');
  s.innerHTML = ''; e.innerHTML = '';
  for (let m = 0; m < 24 * 60; m += 30) {
    const o1 = document.createElement('option'); o1.value = m; o1.textContent = fmtTime(m); s.appendChild(o1);
    const o2 = document.createElement('option'); o2.value = m + 30; o2.textContent = fmtTime(m + 30 === 1440 ? 0 : m + 30) + (m + 30 === 1440 ? ' (+1d)' : ''); e.appendChild(o2);
  }
}

function renderCatRow(selected) {
  const row = document.getElementById('catRow'); row.innerHTML = '';
  CATEGORIES.forEach(c => {
    const pill = document.createElement('button'); pill.type = 'button';
    pill.className = 'cat-pill' + (c.id === selected ? ' selected' : '');
    pill.textContent = c.label;
    pill.style.background = c.id === selected ? c.color : 'transparent';
    pill.style.borderColor = c.color;
    pill.dataset.cat = c.id;
    pill.onclick = () => renderCatRow(c.id);
    row.appendChild(pill);
  });
}

function clearSheetError() {
  const el = document.getElementById('sheetError');
  el.textContent = '';
  el.classList.remove('show');
}

// ---------- Task editor sheet (single create/edit) ----------
function openSheet(id, defaultStart) {
  sheetMode = 'single';
  editingId = id;
  clearSheetError();
  document.getElementById('timeFieldWrap').style.display = 'block';
  document.getElementById('sheetSubText').style.display = 'none';
  document.getElementById('saveBtn').textContent = 'Save';
  const titleI = document.getElementById('taskTitle'), notesI = document.getElementById('taskNotes');
  const startS = document.getElementById('startTime'), endS = document.getElementById('endTime');
  const delBtn = document.getElementById('deleteBtn');
  if (id) {
    const t = tasksById[id];
    titleI.value = t.title; notesI.value = t.notes || '';
    startS.value = t.startMin; endS.value = t.endMin;
    renderCatRow(t.cat); delBtn.style.display = 'block';
  } else {
    titleI.value = ''; notesI.value = '';
    const s = defaultStart != null ? defaultStart : 9 * 60;
    startS.value = s; endS.value = s + 30;
    renderCatRow(DEFAULT_CAT); delBtn.style.display = 'none';
  }
  document.getElementById('backdrop').classList.add('open');
  document.getElementById('sheet').classList.add('open');
  // Only pop the keyboard for a brand-new task (typing a title is the natural
  // first move there) — opening an existing task to just view/edit its
  // category or time shouldn't shove a keyboard in your face.
  if (!id) setTimeout(() => titleI.focus(), 200);
}

// ---------- Task editor sheet (bulk apply to selected slots) ----------
function openBulkSheet() {
  sheetMode = 'bulk';
  editingId = null;
  clearSheetError();
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskNotes').value = '';
  document.getElementById('timeFieldWrap').style.display = 'none';
  document.getElementById('deleteBtn').style.display = 'none';
  const sub = document.getElementById('sheetSubText');
  sub.textContent = `Applies the same task to all ${selectedSlots.size} selected time slots.`;
  sub.style.display = 'block';
  document.getElementById('saveBtn').textContent = `Apply to ${selectedSlots.size} slot${selectedSlots.size === 1 ? '' : 's'}`;
  renderCatRow(DEFAULT_CAT);
  document.getElementById('backdrop').classList.add('open');
  document.getElementById('sheet').classList.add('open');
  setTimeout(() => document.getElementById('taskTitle').focus(), 200);
}

function closeSheet() {
  document.getElementById('backdrop').classList.remove('open');
  document.getElementById('sheet').classList.remove('open');
  editingId = null;
  sheetMode = 'single';
}
document.getElementById('backdrop').onclick = closeSheet;
document.getElementById('sheetCloseBtn').onclick = closeSheet;

// Saves and deletes are instant and local-first: they update tasksById/tasksByDate
// and localStorage right away (so they work with zero connectivity), queue a
// pendingOps entry, and let the background sync loop push it to the Sheet.
document.getElementById('saveBtn').onclick = () => {
  const title = document.getElementById('taskTitle').value.trim();
  const cat = document.querySelector('.cat-pill.selected')?.dataset.cat || DEFAULT_CAT;
  const notes = document.getElementById('taskNotes').value.trim();
  const ds = dateStr(selectedDate);

  if (sheetMode === 'bulk') {
    const idxList = [...selectedSlots].sort((a, b) => a - b);
    idxList.forEach(idx => {
      const t = { id: genId(), date: ds, startMin: idx * 30, endMin: idx * 30 + 30, title, cat, notes, row: null };
      tasksById[t.id] = t;
      (tasksByDate[ds] = tasksByDate[ds] || []).push(t.id);
      pendingOps[t.id] = { type: 'upsert', task: t };
    });
    saveLocalCache(); savePendingOps();
    closeSheet(); exitMultiSelect(); renderTimeline();
    triggerSyncSoon();
    return;
  }

  let startMin = parseInt(document.getElementById('startTime').value);
  let endMin = parseInt(document.getElementById('endTime').value);
  if (endMin <= startMin) endMin = startMin + 30;
  const existingRow = editingId && tasksById[editingId] ? tasksById[editingId].row : null;
  const task = { id: editingId || genId(), date: ds, startMin, endMin, title, cat, notes, row: existingRow };

  tasksById[task.id] = task;
  if (!editingId) (tasksByDate[ds] = tasksByDate[ds] || []).push(task.id);
  pendingOps[task.id] = { type: 'upsert', task };
  saveLocalCache(); savePendingOps();

  closeSheet();
  renderTimeline();
  triggerSyncSoon();
};

document.getElementById('deleteBtn').onclick = () => {
  if (!editingId || !tasksById[editingId]) { closeSheet(); return; }
  const t = tasksById[editingId];
  const ds = t.date;
  tasksByDate[ds] = (tasksByDate[ds] || []).filter(id => id !== editingId);
  delete tasksById[editingId];

  if (t.row) pendingOps[editingId] = { type: 'delete', row: t.row };
  else delete pendingOps[editingId]; // never synced — nothing to delete remotely, just cancel it
  saveLocalCache(); savePendingOps();

  closeSheet();
  renderTimeline();
  triggerSyncSoon();
};

// ---------- Entry point ----------
bootCore(() => {
  document.getElementById('app').style.display = 'flex';
  populateTimeSelects();

  const now = new Date();
  watchedTodayStr = dateStr(now);
  currentMonth = now.getMonth();
  currentYear = now.getFullYear();
  goToDay(now);
  startDateWatcher();
});
