// summary.html only.

const UNTRACKED_COLOR = '#3a3f66';
let summaryMode = 'day';
let selectedSummaryCat = null;

function onDataRefreshed() { recomputeSummary(); }

function daysBetweenInclusive(fromDs, toDs) {
  const a = new Date(fromDs + 'T00:00:00'), b = new Date(toDs + 'T00:00:00');
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

// Percentages are against the full period (days * 24h), with an "Untracked"
// slice for any time with nothing logged — an honest answer to "where did my
// day go", not just a breakdown of the slots you happened to fill in.
function computeCategoryBreakdown(fromDs, toDs) {
  const totals = {};
  let trackedMinutes = 0;
  Object.values(tasksById).forEach(t => {
    if (t.date < fromDs || t.date > toDs) return;
    const dur = Math.max(0, t.endMin - t.startMin);
    totals[t.cat] = (totals[t.cat] || 0) + dur;
    trackedMinutes += dur;
  });
  const daysCount = daysBetweenInclusive(fromDs, toDs);
  const totalMinutes = daysCount * 24 * 60;
  const untrackedMinutes = Math.max(0, totalMinutes - trackedMinutes);

  const breakdown = CATEGORIES
    .map(c => ({ id: c.id, label: c.label, color: catColorHex(c.id), minutes: totals[c.id] || 0 }))
    .filter(b => b.minutes > 0);
  if (untrackedMinutes > 0) breakdown.push({ id: 'untracked', label: 'Untracked', color: UNTRACKED_COLOR, minutes: untrackedMinutes });
  breakdown.sort((a, b) => b.minutes - a.minutes);
  return { breakdown, totalMinutes, trackedMinutes, daysCount };
}

function setSummaryMode(mode) {
  summaryMode = mode;
  document.querySelectorAll('#summaryModeSeg .seg-btn').forEach(b => b.classList.toggle('selected', b.dataset.mode === mode));
  document.getElementById('summaryDayFields').style.display = mode === 'day' ? 'block' : 'none';
  document.getElementById('summaryRangeFields').style.display = mode === 'range' ? 'block' : 'none';
  recomputeSummary();
}
document.querySelectorAll('#summaryModeSeg .seg-btn').forEach(b => b.onclick = () => setSummaryMode(b.dataset.mode));

['summaryDate', 'summaryFrom', 'summaryTo'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => { selectedSummaryCat = null; recomputeSummary(); });
});

function recomputeSummary() {
  let fromDs, toDs, periodLabel;
  if (summaryMode === 'day') {
    const ds = document.getElementById('summaryDate').value || dateStr(new Date());
    fromDs = toDs = ds;
    const d = new Date(ds + 'T00:00:00');
    periodLabel = `${DOW_FULL[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  } else {
    fromDs = document.getElementById('summaryFrom').value;
    toDs = document.getElementById('summaryTo').value;
    if (!fromDs || !toDs) return;
    if (toDs < fromDs) toDs = fromDs;
    periodLabel = `${fromDs} to ${toDs}`;
  }
  const result = computeCategoryBreakdown(fromDs, toDs);
  document.getElementById('summaryPeriodText').textContent = `${periodLabel} · ${result.daysCount} day${result.daysCount === 1 ? '' : 's'} · ${fmtDuration(result.totalMinutes)} total`;
  renderDonut(result);
  renderSummaryLegend(result);
}

function renderDonut(result) {
  const svg = document.getElementById('donutSvg');
  const size = 212, sw = 28, r = (size - sw) / 2, cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let cumBefore = 0;
  const parts = result.breakdown.map(b => {
    const frac = result.totalMinutes > 0 ? b.minutes / result.totalMinutes : 0;
    const dash = frac * circumference;
    const dashOffset = -cumBefore * circumference;
    cumBefore += frac;
    const dim = selectedSummaryCat && selectedSummaryCat !== b.id ? 0.3 : 1;
    const width = selectedSummaryCat === b.id ? sw + 4 : sw;
    return `<circle class="donut-seg" data-cat="${b.id}" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${b.color}" stroke-width="${width}" stroke-linecap="butt" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${dashOffset}" style="opacity:${dim}" />`;
  });
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.innerHTML = parts.join('');
  svg.querySelectorAll('.donut-seg').forEach(el => {
    el.onclick = () => selectSummaryCat(el.dataset.cat, result);
  });
  updateDonutCenter(result);
}

function updateDonutCenter(result) {
  const valEl = document.getElementById('donutCenterVal');
  const lblEl = document.getElementById('donutCenterLabel');
  if (selectedSummaryCat) {
    const b = result.breakdown.find(x => x.id === selectedSummaryCat);
    if (b) {
      const pct = result.totalMinutes > 0 ? Math.round((b.minutes / result.totalMinutes) * 100) : 0;
      valEl.textContent = `${pct}%`;
      lblEl.textContent = `${b.label} · ${fmtDuration(b.minutes)}`;
      return;
    }
  }
  valEl.textContent = fmtDuration(result.trackedMinutes);
  lblEl.textContent = 'Tap a slice for details';
}

function selectSummaryCat(catId, result) {
  selectedSummaryCat = selectedSummaryCat === catId ? null : catId;
  renderDonut(result);
  renderSummaryLegend(result);
}

function renderSummaryLegend(result) {
  const el = document.getElementById('summaryLegend');
  el.innerHTML = '';
  result.breakdown.forEach(b => {
    const pct = result.totalMinutes > 0 ? Math.round((b.minutes / result.totalMinutes) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'legend-row' + (selectedSummaryCat === b.id ? ' selected' : '');
    row.innerHTML = `<span class="dot" style="background:${b.color}"></span><span class="lbl">${b.label}</span><span class="val">${fmtDuration(b.minutes)} · ${pct}%</span>`;
    row.onclick = () => selectSummaryCat(b.id, result);
    el.appendChild(row);
  });
  if (result.breakdown.length === 0) {
    el.innerHTML = '<div class="empty-state">Nothing logged in this period yet.</div>';
  }
}

bootCore(() => {
  document.getElementById('summaryPage').style.display = 'flex';
  const ds = dateStr(new Date());
  document.getElementById('summaryDate').value = ds;
  document.getElementById('summaryFrom').value = ds;
  document.getElementById('summaryTo').value = ds;
  setSummaryMode('day');
});
