/**
 * HtmlReporter.js
 *
 * Generates a self-contained, interactive HTML report summarising the
 * PCF validation and fixing session — before/after geometry, statistics,
 * and a full diff of every changed row.
 *
 * The output is a single .html file with no external dependencies.
 * All styles, scripts, and data are embedded inline.
 */

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function fmtC(c) {
  if (!c) return '—';
  return `(${(c.x ?? 0).toFixed(1)}, ${(c.y ?? 0).toFixed(1)}, ${(c.z ?? 0).toFixed(1)})`;
}

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function coordEq(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.abs((a.x||0)-(b.x||0)) < 0.01 &&
         Math.abs((a.y||0)-(b.y||0)) < 0.01 &&
         Math.abs((a.z||0)-(b.z||0)) < 0.01;
}

const COORD_FIELDS = ['ep1','ep2','cp','bp'];
const SCALAR_FIELDS = ['bore','branchBore','type','skey'];

function getChanges(row1, row2) {
  const changes = [];
  for (const f of COORD_FIELDS) {
    if (!coordEq(row1[f], row2[f])) {
      changes.push({ field: f, from: fmtC(row1[f]), to: fmtC(row2[f]) });
    }
  }
  for (const f of SCALAR_FIELDS) {
    if (String(row1[f] ?? '') !== String(row2[f] ?? '')) {
      changes.push({ field: f, from: String(row1[f] ?? '—'), to: String(row2[f] ?? '—') });
    }
  }
  return changes;
}

// ─────────────────────────────────────────────────────────────
// Build stats from a data array
// ─────────────────────────────────────────────────────────────
function buildStats(rows) {
  const types = {};
  let errors = 0, warnings = 0, fixes = 0, applied = 0;
  (rows || []).forEach(r => {
    const t = (r.type || 'UNKNOWN').toUpperCase();
    types[t] = (types[t] || 0) + 1;
    if (r.fixingAction) {
      if (r.fixingAction.includes('ERROR')) errors++;
      else if (r.fixingAction.includes('WARNING')) warnings++;
      else fixes++;
    }
    if (r._passApplied > 0) applied++;
  });
  return { types, errors, warnings, fixes, applied, total: (rows || []).length };
}

// ─────────────────────────────────────────────────────────────
// CSS (embedded)
// ─────────────────────────────────────────────────────────────
const CSS = `
  :root { --bg:#f8fafc; --card:#fff; --border:#e2e8f0; --text:#1e293b; --muted:#64748b;
          --red:#ef4444; --green:#22c55e; --amber:#f59e0b; --blue:#3b82f6; --purple:#a855f7; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); font-size: 13px; }
  header { background: #0f172a; color: #e2e8f0; padding: 20px 32px; display:flex; justify-content:space-between; align-items:center; }
  header h1 { font-size: 20px; font-weight: 700; }
  header span { font-size: 11px; color: #94a3b8; }
  .container { max-width: 1300px; margin: 0 auto; padding: 24px 24px 60px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  .card .value { font-size: 28px; font-weight: 800; }
  .card .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-top: 4px; }
  .section { margin-bottom: 36px; }
  .section h2 { font-size: 15px; font-weight: 700; border-bottom: 2px solid var(--border); padding-bottom: 8px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f1f5f9; text-align: left; padding: 8px 10px; font-weight: 600; color: var(--muted); text-transform: uppercase; font-size: 10px; letter-spacing: .05em; border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 2; }
  td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  tr:hover td { background: #f8fafc; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 700; }
  .pill-red    { background: #fef2f2; color: var(--red);    border: 1px solid #fecaca; }
  .pill-green  { background: #f0fdf4; color: #16a34a;       border: 1px solid #bbf7d0; }
  .pill-amber  { background: #fffbeb; color: #d97706;       border: 1px solid #fde68a; }
  .pill-blue   { background: #eff6ff; color: var(--blue);   border: 1px solid #bfdbfe; }
  .pill-purple { background: #faf5ff; color: var(--purple); border: 1px solid #e9d5ff; }
  .from { color: var(--red); text-decoration: line-through; opacity: .7; }
  .to   { color: #16a34a; font-weight: 600; }
  .mono { font-family: 'Courier New', monospace; font-size: 11px; }
  .type-badge { display:inline-block; padding:2px 7px; border-radius:4px; font-size:10px; font-weight:700; color:#fff; }
  .chart-bar { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .bar-label { width: 90px; font-size: 11px; color: var(--muted); }
  .bar-track { flex:1; background:#f1f5f9; border-radius:4px; height: 18px; position:relative; overflow:hidden; }
  .bar-fill  { height:100%; border-radius:4px; display:flex; align-items:center; padding-left:8px; font-size:10px; font-weight:700; color:#fff; transition: width .4s; }
  input[type=search] { width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; outline:none; margin-bottom: 12px; }
  .scroll-wrapper { max-height: 500px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; }
  .stat-row { display:flex; justify-content:space-between; padding: 6px 0; border-bottom:1px solid #f1f5f9; font-size:12px; }
  .tag { font-size:10px; background:#f1f5f9; border:1px solid var(--border); border-radius:4px; padding:1px 6px; color:var(--muted); font-weight:600; }
`;

// ─────────────────────────────────────────────────────────────
// JS (embedded — filtering/search)
// ─────────────────────────────────────────────────────────────
const JS = `
  function filterTable(inputId, tableId) {
    const q = document.getElementById(inputId).value.toLowerCase();
    const rows = document.querySelectorAll('#' + tableId + ' tbody tr');
    rows.forEach(r => { r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  }
`;

// ─────────────────────────────────────────────────────────────
// Type colour map
// ─────────────────────────────────────────────────────────────
const TYPE_COLOURS = {
  PIPE:'#3b82f6', VALVE:'#ef4444', FLANGE:'#a855f7',
  BEND:'#f59e0b', TEE:'#10b981', OLET:'#06b6d4', SUPPORT:'#94a3b8',
};
function typeBadge(type) {
  const t = (type || 'UNKNOWN').toUpperCase();
  const bg = TYPE_COLOURS[t] || '#64748b';
  return `<span class="type-badge" style="background:${bg}">${esc(t)}</span>`;
}

// ─────────────────────────────────────────────────────────────
// Main generator
// ─────────────────────────────────────────────────────────────
export function generateHtmlReport(stage1Data, stage2Data, log = []) {
  const s1 = buildStats(stage1Data);
  const s2 = buildStats(stage2Data);

  // Compute diff
  const map1 = Object.fromEntries((stage1Data || []).map(r => [r._rowIndex, r]));
  const diff = [];
  (stage2Data || []).forEach(row2 => {
    const row1 = map1[row2._rowIndex];
    if (!row1) return;
    const changes = getChanges(row1, row2);
    if (changes.length > 0) diff.push({ row: row2, original: row1, changes });
  });

  // Issues from log
  const issues = log.filter(e => e.type === 'Error' || e.type === 'Warning');
  const applied = log.filter(e => e.type === 'Applied' || e.type === 'Fix');

  // Component distribution chart
  const allTypes = Array.from(new Set([...Object.keys(s1.types), ...Object.keys(s2.types)])).sort();
  const maxCount = Math.max(...allTypes.map(t => s2.types[t] || s1.types[t] || 0), 1);

  const chartRows = allTypes.map(t => {
    const count = s2.types[t] || 0;
    const pct = Math.round((count / maxCount) * 100);
    const bg = TYPE_COLOURS[t] || '#64748b';
    return `<div class="chart-bar">
      <div class="bar-label">${typeBadge(t)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${bg}">${count}</div></div>
    </div>`;
  }).join('');

  // Diff table rows
  const diffRows = diff.map(({ row, original, changes }) => {
    const changesList = changes.map(c =>
      `<div style="margin-bottom:4px"><span class="tag">${esc(c.field)}</span>&nbsp;
       <span class="from mono">${esc(c.from)}</span>
       &nbsp;→&nbsp;
       <span class="to mono">${esc(c.to)}</span></div>`
    ).join('');
    const tierPill = row._passApplied
      ? `<span class="pill pill-green">Applied</span>`
      : row.fixingActionTier <= 2
        ? `<span class="pill pill-blue">Auto T${row.fixingActionTier}</span>`
        : `<span class="pill pill-amber">Review T${row.fixingActionTier}</span>`;
    return `<tr>
      <td class="mono">${esc(row._rowIndex)}</td>
      <td>${typeBadge(row.type)}</td>
      <td>${changesList}</td>
      <td>${tierPill}</td>
      <td style="max-width:300px;font-size:11px;color:#64748b">${esc((row.fixingAction || '').substring(0, 120))}</td>
    </tr>`;
  }).join('');

  // Issues table rows
  const issueRows = issues.map(e => {
    const pillClass = e.type === 'Error' ? 'pill-red' : 'pill-amber';
    return `<tr>
      <td><span class="pill ${pillClass}">${esc(e.type)}</span></td>
      <td class="mono">${esc(e.ruleId || '—')}</td>
      <td class="mono">${esc(e.row || '—')}</td>
      <td>${esc(e.message)}</td>
    </tr>`;
  }).join('');

  const now = new Date().toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PCF Validation Report — ${now}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <div>
    <h1>PCF Validation &amp; Smart Fixer Report</h1>
    <div style="margin-top:4px;font-size:12px;color:#94a3b8">Generated ${now}</div>
  </div>
  <span>${esc(s1.total)} components processed</span>
</header>

<div class="container">

  <!-- Summary KPIs -->
  <div class="grid">
    <div class="card">
      <div class="value" style="color:#3b82f6">${s1.total}</div>
      <div class="label">Total Components (Stage 1)</div>
    </div>
    <div class="card">
      <div class="value" style="color:#ef4444">${s2.errors}</div>
      <div class="label">Errors Found</div>
    </div>
    <div class="card">
      <div class="value" style="color:#f59e0b">${s2.warnings}</div>
      <div class="label">Warnings Found</div>
    </div>
    <div class="card">
      <div class="value" style="color:#22c55e">${s2.applied}</div>
      <div class="label">Fixes Applied</div>
    </div>
    <div class="card">
      <div class="value" style="color:#a855f7">${diff.length}</div>
      <div class="label">Rows Changed</div>
    </div>
    <div class="card">
      <div class="value" style="color:#06b6d4">${issues.length}</div>
      <div class="label">Log Entries</div>
    </div>
  </div>

  <!-- Component Distribution -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px;">
    <div class="card section" style="margin-bottom:0">
      <h2>Component Distribution</h2>
      ${chartRows}
    </div>
    <div class="card section" style="margin-bottom:0">
      <h2>Session Summary</h2>
      <div class="stat-row"><span>Stage 1 rows</span><strong>${s1.total}</strong></div>
      <div class="stat-row"><span>Stage 2 rows (after fixes)</span><strong>${s2.total}</strong></div>
      <div class="stat-row"><span>Rows inserted</span><strong style="color:#22c55e">${Math.max(0,s2.total - s1.total)}</strong></div>
      <div class="stat-row"><span>Rows deleted</span><strong style="color:#ef4444">${Math.max(0,s1.total - s2.total)}</strong></div>
      <div class="stat-row"><span>Rows with proposals</span><strong style="color:#3b82f6">${s2.fixes + s2.errors + s2.warnings}</strong></div>
      <div class="stat-row"><span>Fixes auto-applied (T1/T2)</span><strong style="color:#22c55e">${s2.applied}</strong></div>
    </div>
  </div>

  <!-- Geometry Diff -->
  <div class="section">
    <h2>Geometry Changes (Stage 1 → Stage 2) &mdash; ${diff.length} row${diff.length !== 1 ? 's' : ''} changed</h2>
    <input type="search" id="diffSearch" placeholder="Search changes…" oninput="filterTable('diffSearch','diffTable')">
    <div class="scroll-wrapper">
      <table id="diffTable">
        <thead><tr><th>#</th><th>Type</th><th>Changes</th><th>Tier</th><th>Fixing Action</th></tr></thead>
        <tbody>${diffRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No geometry changes detected.</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <!-- Issues Log -->
  <div class="section">
    <h2>Validation Issues &mdash; ${issues.length} entries</h2>
    <input type="search" id="issueSearch" placeholder="Search issues…" oninput="filterTable('issueSearch','issueTable')">
    <div class="scroll-wrapper">
      <table id="issueTable">
        <thead><tr><th>Type</th><th>Rule</th><th>Row</th><th>Message</th></tr></thead>
        <tbody>${issueRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No issues logged.</td></tr>'}</tbody>
      </table>
    </div>
  </div>

</div>
<script>${JS}</script>
</body>
</html>`;
}
