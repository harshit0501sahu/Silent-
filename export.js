// export.html only.

let exportMode = 'range';

function onDataRefreshed() { /* export reads tasksById fresh at generate-time, nothing to re-render */ }

function setExportMode(mode) {
  exportMode = mode;
  document.querySelectorAll('#exportModeSeg .seg-btn').forEach(b => b.classList.toggle('selected', b.dataset.mode === mode));
  document.getElementById('rangeFields').style.display = mode === 'range' ? 'block' : 'none';
  document.getElementById('monthFields').style.display = mode === 'month' ? 'block' : 'none';
  document.getElementById('exportSubText').textContent = mode === 'range'
    ? 'Pick a date range to export (a single day, or up to a year and beyond).'
    : 'Pick a start and end month — every month in between is bundled into one PDF.';
}
document.querySelectorAll('#exportModeSeg .seg-btn').forEach(b => b.onclick = () => setExportMode(b.dataset.mode));

async function generateExportPdf() {
  const errEl = document.getElementById('exportError');
  errEl.textContent = '';
  const btn = document.getElementById('exportGenerateBtn');

  const ranges = [];
  if (exportMode === 'range') {
    const from = document.getElementById('exportFrom').value;
    const to = document.getElementById('exportTo').value;
    if (!from || !to) { errEl.textContent = 'Pick both dates.'; return; }
    if (to < from) { errEl.textContent = 'End date must be on or after the start date.'; return; }
    ranges.push({ label: `${from} to ${to}`, fromDs: from, toDs: to });
  } else {
    const fromM = document.getElementById('exportFromMonth').value;
    const toM = document.getElementById('exportToMonth').value;
    if (!fromM || !toM) { errEl.textContent = 'Pick both months.'; return; }
    if (toM < fromM) { errEl.textContent = 'End month must be on or after the start month.'; return; }
    let [fy, fm] = fromM.split('-').map(Number);
    const [ty, tm] = toM.split('-').map(Number);
    let y = fy, m = fm;
    while (y < ty || (y === ty && m <= tm)) {
      const first = new Date(y, m - 1, 1);
      const last = new Date(y, m, 0);
      ranges.push({ label: `${MONTHS[m - 1]} ${y}`, fromDs: dateStr(first), toDs: dateStr(last) });
      m++; if (m > 12) { m = 1; y++; }
    }
  }

  if (!window.jspdf) { errEl.textContent = "PDF library didn't load. Check your connection and try again."; return; }

  btn.disabled = true; btn.textContent = 'Generating…';
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const marginX = 40;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    ranges.forEach((r, idx) => {
      if (idx > 0) doc.addPage();
      let y = 50;
      doc.setFont('helvetica', 'italic'); doc.setFontSize(20); doc.setTextColor(20, 20, 30);
      doc.text('Planner', marginX, y); y += 22;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(110, 110, 110);
      doc.text(r.label, marginX, y); y += 18;
      doc.setDrawColor(215, 215, 215); doc.line(marginX, y, pageW - marginX, y); y += 22;

      const tasks = Object.values(tasksById)
        .filter(t => t.date >= r.fromDs && t.date <= r.toDs)
        .sort((a, b) => (a.date === b.date ? a.startMin - b.startMin : (a.date < b.date ? -1 : 1)));

      if (tasks.length === 0) {
        doc.setTextColor(130, 130, 130); doc.setFontSize(11);
        doc.text('No tasks in this period.', marginX, y);
        return;
      }

      let lastDate = null;
      tasks.forEach(t => {
        if (y > pageH - 60) { doc.addPage(); y = 50; lastDate = null; }
        if (t.date !== lastDate) {
          lastDate = t.date;
          const d = new Date(t.date + 'T00:00:00');
          y += 8;
          doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 20, 30);
          doc.text(`${DOW_FULL[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`, marginX, y);
          y += 16;
        }
        const [cr, cg, cb] = hexToRgb(catColorHex(t.cat));
        const catLabel = CAT_MAP[t.cat] ? CAT_MAP[t.cat].label : t.cat;
        const hasTitle = !!(t.title && t.title.trim());
        const headline = hasTitle ? t.title : catLabel;
        doc.setFillColor(cr, cg, cb);
        doc.rect(marginX, y - 9, 8, 8, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(20, 20, 30);
        doc.text(`${fmtTime(t.startMin)} - ${fmtTime(t.endMin)}  ${headline}`, marginX + 14, y);
        y += 13;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(130, 130, 130);
        const subLine = (hasTitle ? catLabel : '') + (t.notes ? (hasTitle ? '  |  ' : '') + t.notes : '');
        if (subLine) doc.text(subLine, marginX + 14, y);
        else y -= 13; // no sub-line to print — reclaim the vertical space instead of leaving a gap
        y += 18;
      });
    });

    const filename = exportMode === 'range'
      ? `Planner_${ranges[0].fromDs}_to_${ranges[0].toDs}.pdf`
      : `Planner_${ranges[0].label.replace(/ /g, '')}_to_${ranges[ranges.length - 1].label.replace(/ /g, '')}.pdf`;
    doc.save(filename);
  } catch (e) {
    errEl.textContent = `Couldn't generate PDF: ${e.message}`;
  } finally {
    btn.disabled = false; btn.textContent = 'Download PDF';
  }
}
document.getElementById('exportGenerateBtn').onclick = generateExportPdf;

bootCore(() => {
  document.getElementById('exportPage').style.display = 'flex';
  const todayDs = dateStr(new Date());
  document.getElementById('exportFrom').value = todayDs;
  document.getElementById('exportTo').value = todayDs;
  const now = new Date();
  const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  document.getElementById('exportFromMonth').value = ym;
  document.getElementById('exportToMonth').value = ym;
  setExportMode('range');
});
