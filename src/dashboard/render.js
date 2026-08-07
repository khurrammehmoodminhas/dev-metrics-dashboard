import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readClientScript(name) {
  return fs.readFileSync(path.join(__dirname, 'client', name), 'utf8');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch],
  );
}

/**
 * Renders the Engineering Delivery & AI Insights Dashboard. Node does all
 * fetching/normalization (see src/index.js) but NO aggregation — aggregation
 * is relative to whatever release(s) are selected, which is a runtime browser
 * concern (dashboard/client/picker.js), recomputed on every selection change
 * via the shared dashboard/client/deliveryMath.js + timeSeries.js. This
 * function's only job is to embed the full {releases, tickets} dataset and
 * inline those client scripts into a static HTML shell with the section
 * containers.
 */
export function renderDashboard(bundle) {
  const { generated_at: generatedAt, releases, tickets, stale_pr_after_days: stalePrAfterDays, default_selected_releases: defaultSelectedReleases = [] } = bundle;
  const deliveryMathSource = readClientScript('deliveryMath.js');
  const timeSeriesSource = readClientScript('timeSeries.js');
  const chartsSource = readClientScript('charts.js');
  const pickerSource = readClientScript('picker.js');
  const dataJson = JSON.stringify({ releases, tickets, stale_pr_after_days: stalePrAfterDays, default_selected_releases: defaultSelectedReleases }).replaceAll('<', '\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Engineering Delivery &amp; AI Insights Dashboard</title>
<style>
  :root {
    color-scheme: light;
    --surface-1: #fcfcfb;
    --surface-2: #f3f2ef;
    --page-plane: #f9f9f7;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --text-muted: #898781;
    --gridline: #e1e0d9;
    --baseline: #c3c2b7;
    --border: rgba(11,11,11,0.10);
    --shadow: rgba(11,11,11,0.06);
    --series-1: #2a78d6;
    --series-1-track: #cde2fb;
    --series-2: #eb6834;
    --series-3: #1baf7a;
    --series-4: #eda100;
    --status-good: #0ca30c;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --surface-2: #232322;
      --page-plane: #0d0d0d;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted: #898781;
      --gridline: #2c2c2a;
      --baseline: #383835;
      --border: rgba(255,255,255,0.10);
      --shadow: rgba(0,0,0,0.4);
      --series-1: #3987e5;
      --series-1-track: #184f95;
      --series-2: #d95926;
      --series-3: #199e70;
      --series-4: #c98500;
      --status-good: #0ca30c;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --surface-2: #232322;
    --page-plane: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #898781;
    --gridline: #2c2c2a;
    --baseline: #383835;
    --border: rgba(255,255,255,0.10);
    --shadow: rgba(0,0,0,0.4);
    --series-1: #3987e5;
    --series-1-track: #184f95;
    --series-2: #d95926;
    --series-3: #199e70;
    --series-4: #c98500;
    --status-good: #0ca30c;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--page-plane);
    color: var(--text-primary);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 32px 24px 64px;
  }
  .wrap { max-width: 1280px; margin: 0 auto; }
  h1 { font-size: 24px; font-weight: 650; margin: 0 0 6px; letter-spacing: -0.01em; }
  h2 { font-size: 16px; font-weight: 650; margin: 0 0 12px; }
  h3 { font-size: 16px; font-weight: 650; margin: 0 0 12px; }
  .subsection-title { font-size: 13px; font-weight: 650; margin: 16px 0 8px; }
  .timeline-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin: 16px 0 8px; }
  .meta { color: var(--text-secondary); font-size: 13px; margin-bottom: 20px; }
  .caveat { color: var(--text-muted); font-size: 12.5px; margin: -4px 0 16px; max-width: 76ch; line-height: 1.5; }
  .section { margin-bottom: 36px; }
  .card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    box-shadow: 0 1px 2px var(--shadow);
  }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 760px) { .two-col { grid-template-columns: 1fr; } }
  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .kpi-tile .stat-label { display: block; color: var(--text-secondary); font-size: 12px; }
  .kpi-tile .stat-value { display: block; font-size: 26px; font-weight: 650; margin-top: 6px; letter-spacing: -0.01em; }
  .coverage-note { font-size: 11px; font-weight: 500; color: var(--text-muted); }

  .release-picker {
    display: flex; flex-wrap: wrap; gap: 10px; padding: 14px;
    background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px;
    margin-bottom: 20px;
  }
  .release-option { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .release-option input { width: 16px; height: 16px; cursor: pointer; }
  .released-tag { font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }

  .dev-summary-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .dev-summary-stats .stat-label { display: block; color: var(--text-secondary); font-size: 11px; }
  .dev-summary-stats .stat-value { display: block; font-size: 18px; font-weight: 650; }

  .ticket-filters { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 12px; }
  .filter-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); font-weight: 600; }
  .filter-label select {
    font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--surface-1); color: var(--text-primary); min-width: 160px;
  }

  .data-table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
  .data-table th, .data-table td {
    text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--gridline);
    font-variant-numeric: tabular-nums; vertical-align: top;
  }
  .data-table th:nth-child(1), .data-table td:nth-child(1) { width: 96px; }
  .data-table th:nth-child(2), .data-table td:nth-child(2) { width: 104px; }
  .data-table th:nth-child(3), .data-table td:nth-child(3) { width: 360px; }
  .data-table th:nth-child(4), .data-table td:nth-child(4) { width: 132px; }
  .data-table th:nth-child(5), .data-table td:nth-child(5) { width: 116px; }
  .data-table th:nth-child(6), .data-table td:nth-child(6) { width: 64px; }
  .data-table th:nth-child(7), .data-table td:nth-child(7) { width: 64px; }
  .data-table th:nth-child(8), .data-table td:nth-child(8) { width: 112px; }
  .data-table th:nth-child(9), .data-table td:nth-child(9) { width: 172px; }
  .data-table th {
    color: var(--text-secondary); font-weight: 650; font-size: 11.5px;
    text-transform: uppercase; letter-spacing: 0.02em;
  }
  .data-table th.sortable { cursor: pointer; user-select: none; }
  .data-table th.sortable:hover { color: var(--text-primary); }
  .data-table tbody tr:hover { background: var(--surface-2); }
  .editable-cell { cursor: pointer; min-width: 0; }
  .editable-cell.is-editing { padding: 0; }
  .editable-cell .inline-edit-control { width: 100%; font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-1); color: var(--text-primary); box-sizing: border-box; }
  #developer-delivery .dev-row { cursor: pointer; }
  .data-table a { color: var(--series-1); text-decoration: none; }
  .data-table a:hover { text-decoration: underline; }
  .empty-state { color: var(--text-muted); font-size: 13px; }
  .inline-btn {
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text-primary);
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
  }
  .inline-btn:hover { background: var(--surface-1); }
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(11, 11, 11, 0.45); display: flex;
    align-items: center; justify-content: center; padding: 20px; z-index: 1000;
  }
  .modal-card {
    width: min(480px, 100%); background: var(--surface-1); border: 1px solid var(--border);
    border-radius: 12px; box-shadow: 0 10px 26px var(--shadow); padding: 20px;
  }
  .modal-card h3 { margin-bottom: 12px; }
  .field-grid { display: grid; gap: 12px; }
  .field-row { display: flex; flex-direction: column; gap: 6px; }
  .field-row label { font-size: 12px; font-weight: 650; color: var(--text-secondary); }
  .field-row input, .field-row select {
    font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--surface-1); color: var(--text-primary);
  }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

  /* Charts */
  .chart-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 8px; font-size: 12px; color: var(--text-secondary); }
  .chart-legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .chart-legend-swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .chart-gridline { stroke: var(--gridline); stroke-width: 1; }
  .chart-reference-line { stroke: var(--text-muted); stroke-width: 1.5; stroke-dasharray: 4 4; }
  .chart-axis-label { fill: var(--text-muted); font-size: 11px; }
  .chart-series-label { font-size: 11px; font-weight: 650; }

  .status-bar { display: flex; height: 28px; border-radius: 6px; overflow: hidden; background: var(--gridline); margin-bottom: 10px; }
  .status-bar-segment { height: 100%; }

  .histogram { display: flex; flex-direction: column; gap: 8px; }
  .histogram-row { display: grid; grid-template-columns: 56px 1fr 32px; align-items: center; gap: 8px; font-size: 12px; }
  .histogram-label { color: var(--text-secondary); }
  .histogram-track { height: 8px; border-radius: 4px; background: var(--series-1-track); overflow: hidden; }
  .histogram-fill { height: 100%; background: var(--series-1); border-radius: 4px; }
  .histogram-count { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
</style>
</head>
<body>
<div class="wrap">
  <h1>Engineering Delivery &amp; AI Insights Dashboard</h1>
  <p class="meta">Generated ${escapeHtml(generatedAt.slice(0, 16)).replace('T', ' ')} UTC · Select release(s) below — everything recalculates instantly, nothing here is a performance score.</p>

  <div class="section">
    <div id="release-picker" class="release-picker"></div>
  </div>

  <div class="section">
    <h2>1. Release Summary</h2>
    <div id="release-summary"></div>
  </div>

  <div class="section">
    <h2>2. Release Progress Over Time</h2>
    <p class="caveat">Cumulative delivery against the release's total planned SP — shows whether work is landing steadily or bunching up toward the end.</p>
    <div id="release-progress"></div>
  </div>

  <div class="section two-col">
    <div class="card">
      <h2>3. Ticket Status Breakdown</h2>
      <div id="ticket-status-breakdown"></div>
    </div>
    <div class="card">
      <h2>4. Issue Type Breakdown</h2>
      <div id="issue-type-breakdown"></div>
    </div>
  </div>

  <div class="section">
    <h2>5. Engineering Activity Trend</h2>
    <p class="caveat">Descriptive only — whether the team was active throughout the release or activity was concentrated in bursts. Not an activity score.</p>
    <div id="engineering-activity-trend"></div>
  </div>

  <div class="section">
    <h2>6. PR Activity Trend</h2>
    <div id="pr-activity-trend"></div>
  </div>

  <div class="section">
    <h2>7. Delivery Flow: In Progress → Code Review</h2>
    <div id="cycle-time"></div>
  </div>

  <div class="section">
    <h2>8. Developer Delivery</h2>
    <p class="meta" style="margin-top:-6px;">Click a row to see that developer's tickets below. Delivered AP is the primary delivery metric; Planned SP is workload context.</p>
    <div id="developer-delivery"></div>
  </div>

  <div class="section">
    <h2>9. Developer Details</h2>
    <div id="developer-details"></div>
  </div>

  <div class="section">
    <h2>10. All Release Tickets</h2>
    <div id="all-tickets"></div>
  </div>
</div>
<script>
  window.__DASHBOARD_DATA__ = ${dataJson};
</script>
<script>
${deliveryMathSource}
</script>
<script>
${timeSeriesSource}
</script>
<script>
${chartsSource}
</script>
<script>
${pickerSource}
</script>
</body>
</html>`;
}
