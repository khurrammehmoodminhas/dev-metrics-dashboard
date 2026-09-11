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
  const assistantSource = readClientScript('assistant.js');
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
    --surface-1: #ffffff;
    --surface-2: #f8f9fa;
    --surface-3: #f0f2f5;
    --page-plane: #f5f7fa;
    --text-primary: #1a1a1a;
    --text-secondary: #52514e;
    --text-muted: #898781;
    --gridline: #e1e0d9;
    --baseline: #c3c2b7;
    --border: rgba(11,11,11,0.08);
    --border-soft: rgba(11,11,11,0.05);
    --shadow: rgba(0,0,0,0.04);
    --shadow-card: rgba(0,0,0,0.04);
    --shadow-hover: rgba(0,0,0,0.08);
    --series-1: #2a78d6;
    --series-1-track: #cde2fb;
    --series-2: #eb6834;
    --series-3: #1baf7a;
    --series-4: #eda100;
    --status-good: #0ca30c;
    --radius: 12px;
    --radius-card: 10px;
    --transition: all 0.2s ease;
    --font-sans: "Avenir Next", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --gradient-1: linear-gradient(135deg, #2a78d6 0%, #4a9eff 100%);
    --gradient-2: linear-gradient(135deg, #eb6834 0%, #ff8c42 100%);
    --gradient-accent: linear-gradient(135deg, #2a78d6 0%, #1baf7a 100%);
  }
    @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --surface-2: #232322;
      --surface-3: #2a2a29;
      --page-plane: #0d0d0d;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted: #898781;
      --gridline: #2c2c2a;
      --baseline: #383835;
      --border: rgba(255,255,255,0.10);
      --border-soft: rgba(255,255,255,0.06);
      --shadow: rgba(0,0,0,0.4);
      --shadow-card: rgba(0,0,0,0.3);
      --shadow-hover: rgba(0,0,0,0.5);
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
    --surface-3: #2a2a29;
    --page-plane: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #898781;
    --gridline: #2c2c2a;
    --baseline: #383835;
    --border: rgba(255,255,255,0.10);
    --border-soft: rgba(255,255,255,0.06);
    --shadow: rgba(0,0,0,0.4);
    --shadow-card: rgba(0,0,0,0.3);
    --shadow-hover: rgba(0,0,0,0.5);
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
    background: radial-gradient(ellipse at 50% 0%, var(--surface-2) 0%, var(--page-plane) 100%);
    color: var(--text-primary);
    font-family: var(--font-sans);
    padding: 32px 24px 64px;
    transition: background 0.3s ease, color 0.3s ease;
  }
  .wrap { max-width: 1280px; margin: 0 auto; }
  html { scroll-behavior: smooth; }
  .dashboard-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 12px; }
  .eyebrow {
    display: inline-flex; align-items: center; gap: 8px; margin-bottom: 8px;
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em;
    color: var(--series-1);
  }
  .eyebrow::before { content: ''; width: 22px; height: 3px; border-radius: 2px; background: var(--gradient-accent); }
  h1 { font-size: 34px; font-weight: 800; margin: 0; letter-spacing: -0.02em; line-height: 1.08; color: var(--text-primary);
    padding-bottom: 12px; position: relative; display: inline-block; }
  h1::after { content: ''; position: absolute; left: 2px; bottom: 0; height: 4px; width: 96px; border-radius: 3px; background: var(--gradient-accent); }
  .hero-sub { margin-top: 10px; }
  .dashboard-header .meta { margin-top: 6px; }
  .section { margin-bottom: 40px; animation: sectionReveal 0.5s ease both; }
  @keyframes sectionReveal { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .section:nth-child(even) { animation-delay: 0.05s; }
  h2 { font-size: 17px; font-weight: 650; margin: 0 0 16px; }
  h3 { font-size: 16px; font-weight: 650; margin: 0 0 12px; }
  .subsection-title { font-size: 13px; font-weight: 650; margin: 18px 0 8px; color: var(--text-secondary); }
  .timeline-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin: 16px 0 8px; }
  .meta { color: var(--text-secondary); font-size: 13px; margin: 4px 0 0; line-height: 1.5; }
  .caveat { color: var(--text-muted); font-size: 12.5px; margin: -4px 0 16px; max-width: 76ch; line-height: 1.5; }
  .section > h2 {
    padding-left: 12px; border-left: 3px solid var(--series-1); position: relative;
  }
  .section > h2::before {
    content: ''; position: absolute; left: -4px; top: 2px; width: 4px; height: 20px;
    background: var(--gradient-1); border-radius: 2px;
  }
  .card {
    background: var(--surface-1);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-card);
    padding: 20px;
    box-shadow: 0 4px 16px var(--shadow-card);
    transition: var(--transition);
  }
  .card:hover {
    box-shadow: 0 6px 20px var(--shadow-hover);
    transform: translateY(-1px);
  }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 760px) { .two-col { grid-template-columns: 1fr; } }
  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .kpi-tile {
    background: var(--gradient-1);
    border-radius: var(--radius);
    padding: 16px;
    text-align: center;
    transition: var(--transition);
    color: #fff;
  }
  .kpi-tile:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px var(--shadow-hover);
  }
  .kpi-tile.stat-good { background: var(--gradient-accent); }
  .kpi-tile.stat-warn { background: linear-gradient(135deg, #eda100 0%, #f5b842 100%); }
  .kpi-tile .stat-label { display: block; color: rgba(255,255,255,0.9); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; }
  .kpi-tile .stat-value { display: block; font-size: 28px; font-weight: 700; margin-top: 6px; letter-spacing: -0.01em; }
  .coverage-note { font-size: 11px; font-weight: 500; color: var(--text-muted); }

  .release-picker {
    display: flex; flex-wrap: wrap; gap: 8px; padding: 16px;
    background: var(--surface-1); border: 1px solid var(--border-soft);
    border-radius: var(--radius-card); margin-bottom: 8px;
    box-shadow: 0 2px 8px var(--shadow-card);
  }
  .release-option {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 13px; font-weight: 600; cursor: pointer;
    padding: 6px 10px; border-radius: 8px;
    background: var(--surface-2); border: 1px solid var(--border-soft);
    transition: var(--transition);
  }
  .release-option:hover { background: var(--surface-3); }
  .release-option input { width: 16px; height: 16px; cursor: pointer; accent-color: var(--series-1); }
  .released-tag { font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }

  .dev-summary-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 16px; margin-bottom: 20px; }
  .dev-summary-stats .stat-label { display: block; color: var(--text-secondary); font-size: 11px; }
  .dev-summary-stats .stat-value { display: block; font-size: 22px; font-weight: 650; }

  .ticket-filters { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 12px; }
  .filter-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); font-weight: 600; }
  .filter-label select {
    font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--surface-1); color: var(--text-primary); min-width: 160px; transition: var(--transition);
  }
  .filter-label select:focus { outline: 2px solid var(--series-1); outline-offset: 1px; }

  .data-table { width: 100%; border-collapse: separate; border-spacing: 0 4px; font-size: 13px; table-layout: auto; }
  .data-table th, .data-table td {
    text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border-soft);
    font-variant-numeric: tabular-nums; vertical-align: top; background: var(--surface-1);
    overflow-wrap: break-word; box-sizing: border-box;
  }
  .data-table thead th {
    background: var(--surface-2); color: var(--text-secondary); font-weight: 650; font-size: 11.5px;
    text-transform: uppercase; letter-spacing: 0.02em; border-radius: 6px; white-space: nowrap;
    border: 1px solid var(--border-soft);
  }
  #all-tickets-table { table-layout: fixed; min-width: 1320px; }
  #all-tickets-table th:nth-child(1), #all-tickets-table td:nth-child(1) { width: 86px; }
  #all-tickets-table th:nth-child(2), #all-tickets-table td:nth-child(2) { width: 96px; }
  #all-tickets-table th:nth-child(3), #all-tickets-table td:nth-child(3) { width: 270px; }
  #all-tickets-table th:nth-child(4), #all-tickets-table td:nth-child(4) { width: 112px; }
  #all-tickets-table th:nth-child(5), #all-tickets-table td:nth-child(5) { width: 104px; }
  #all-tickets-table th:nth-child(6), #all-tickets-table td:nth-child(6) { width: 46px; }
  #all-tickets-table th:nth-child(7), #all-tickets-table td:nth-child(7) { width: 46px; }
  #all-tickets-table th:nth-child(8), #all-tickets-table td:nth-child(8) { width: 140px; }
  #all-tickets-table th:nth-child(9), #all-tickets-table td:nth-child(9) { width: 168px; }
  #all-tickets-table th:nth-child(10), #all-tickets-table td:nth-child(10) { width: 250px; }
  .table-scroll-container { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .data-table th {
    color: var(--text-secondary); font-weight: 650; font-size: 11.5px;
    text-transform: uppercase; letter-spacing: 0.02em;
  }
  .data-table th.sortable { cursor: pointer; user-select: none; }
  .data-table th.sortable:hover { color: var(--text-primary); }
  .data-table tbody tr:hover { background: var(--surface-3); }
  .editable-cell { cursor: pointer; min-width: 0; position: relative; }
  .editable-cell:hover { background: var(--surface-2); }
  .editable-cell .inline-edit-control { width: 100%; font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-1); color: var(--text-primary); box-sizing: border-box; }
  #developer-delivery .dev-row { cursor: pointer; }
  .data-table a { color: var(--series-1); text-decoration: none; }
  .data-table a:hover { text-decoration: underline; }
  .empty-state { color: var(--text-muted); font-size: 13px; text-align: center; padding: 16px; }
  .inline-btn {
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text-primary);
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
    transition: var(--transition);
  }
  .inline-btn:hover { background: var(--surface-3); }

  /* Code review logging */
  .review-log-cell { min-width: 210px; }
  .review-log-list { display: grid; gap: 6px; }
  .review-log-entry {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 4px 8px; border: 1px solid var(--border-soft);
    border-radius: 8px; background: var(--surface-2); font-size: 12px;
  }
  .review-log-label { font-weight: 650; word-break: break-word; }
  .review-log-time { color: var(--text-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .review-log-actions { margin-left: auto; display: inline-flex; gap: 4px; }
  .review-log-action-btn {
    border: 1px solid var(--border); background: var(--surface-1); color: var(--text-secondary);
    border-radius: 6px; padding: 2px 6px; font-size: 11px; cursor: pointer; line-height: 1.4; transition: var(--transition);
  }
  .review-log-action-btn:hover { background: var(--surface-3); color: var(--text-primary); }
  .review-log-action-btn.delete:hover { color: #c62828; border-color: rgba(198, 40, 40, 0.4); }
  .log-review-btn {
    margin-top: 8px; width: 100%;
    border: 1px dashed var(--series-2); background: rgba(235, 104, 52, 0.06);
    color: var(--series-2); border-radius: 8px; padding: 7px 10px;
    font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; transition: var(--transition);
  }
  .log-review-btn:hover { background: rgba(235, 104, 52, 0.12); }

  .review-modal-card { width: min(480px, 100%); border-radius: var(--radius); }
  .review-modal-card .assistant-modal-header h2 { font-size: 16px; }
  .review-modal-body { display: grid; gap: 14px; margin-top: 18px; }
  .review-modal-body .filter-label select { min-width: 100%; }
  .review-time-inputs { display: inline-flex; align-items: center; gap: 6px; }
  .review-time-inputs input {
    width: 64px; font: inherit; padding: 8px 10px; border-radius: 8px;
    border: 1px solid var(--border); background: var(--surface-1); color: var(--text-primary);
    box-sizing: border-box;
  }
  .review-time-inputs input:focus { outline: 2px solid var(--series-1); outline-offset: 1px; }
  .review-modal-note { font-size: 12px; color: var(--text-muted); margin: 0; }
  .review-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  .review-modal-save {
    background: var(--gradient-1); color: #fff; border: none;
    border-radius: 8px; padding: 8px 16px; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; transition: var(--transition);
  }
  .review-modal-save:hover { filter: brightness(1.08); }
  .review-modal-save:disabled { opacity: 0.6; cursor: wait; }
  @media (prefers-color-scheme: dark) {
    .review-log-action-btn.delete:hover { color: #ff8a80; border-color: rgba(255, 138, 128, 0.4); }
  }
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: flex;
    align-items: center; justify-content: center; padding: 20px; z-index: 1000;
  }
  .modal-card {
    width: min(520px, 100%); background: var(--surface-1); border: 1px solid var(--border-soft);
    border-radius: var(--radius); box-shadow: 0 20px 40px var(--shadow); padding: 24px;
  }
  .modal-card h3 { margin: 0 0 16px; font-size: 16px; }
  .field-grid { display: grid; gap: 12px; }
  .field-row { display: flex; flex-direction: column; gap: 6px; }
  .field-row label { font-size: 12px; font-weight: 650; color: var(--text-secondary); }
  .field-row input, .field-row select {
    font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--surface-1); color: var(--text-primary); transition: var(--transition);
  }
  .field-row input:focus, .field-row select:focus { outline: 2px solid var(--series-1); outline-offset: 1px; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
  .modal-actions .inline-btn { padding: 8px 16px; font-size: 13px; }

  /* Charts */
  .chart-container { background: var(--surface-1); border-radius: var(--radius-card); padding: 16px; border: 1px solid var(--border-soft); }
  .chart-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 8px; font-size: 12px; color: var(--text-secondary); }
  .chart-legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .chart-legend-swatch { width: 10px; height: 10px; border-radius: 4px; display: inline-block; }
  .chart-gridline { stroke: var(--gridline); stroke-width: 1; }
  .chart-reference-line { stroke: var(--text-muted); stroke-width: 1.5; stroke-dasharray: 6 4; }
  .chart-axis-label { fill: var(--text-secondary); font-size: 11px; font-weight: 500; }
  .chart-series-label { font-size: 11px; font-weight: 650; fill: var(--text-secondary); }
  .chart-line { fill: none; stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
  .chart-dot { cursor: pointer; }
  .status-bar { display: flex; height: 32px; border-radius: 8px; overflow: hidden; background: var(--gridline); margin-bottom: 12px; }
  .status-bar-segment { height: 100%; transition: all 0.3s ease; }

  .chart-actions { display: flex; gap: 6px; margin-left: auto; }
  .chart-action-btn {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 11px; font-weight: 600; padding: 4px 10px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1); color: var(--text-secondary); cursor: pointer;
    transition: var(--transition);
  }
  .chart-action-btn:hover { background: var(--surface-2); color: var(--text-primary); }
  .chart-action-btn svg { width: 14px; height: 14px; }

  .chart-modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; padding: 20px;
  }
  .chart-modal {
    background: var(--surface-1); border-radius: var(--radius-card);
    max-width: 95vw; max-height: 95vh; overflow: auto;
    position: relative;
  }
  .chart-modal-close {
    position: absolute; top: 12px; right: 12px;
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 50%; width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; font-size: 18px; color: var(--text-primary);
    z-index: 1;
  }
  .chart-modal-close:hover { background: var(--surface-3); }
  .chart-modal-body { padding: 24px; }

  .histogram { display: flex; flex-direction: column; gap: 10px; }
  .histogram-row { display: grid; grid-template-columns: 56px 1fr 32px; align-items: center; gap: 8px; font-size: 12px; }
  .histogram-label { color: var(--text-secondary); font-weight: 600; }
  .histogram-track { height: 10px; border-radius: 6px; background: var(--series-1-track); overflow: hidden; }
  .histogram-fill { height: 100%; background: var(--gradient-1); border-radius: 6px; transition: width 0.4s ease; }
  .histogram-count { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
  .dashboard-actions { display: flex; align-items: center; gap: 12px; margin: 0 0 16px; }
  .refresh-button {
    font: inherit; font-size: 12px; font-weight: 650; padding: 7px 14px;
    border: 1px solid var(--border); border-radius: 8px;
    background: var(--surface-1); color: var(--text-primary); cursor: pointer;
        transition: var(--transition);
  }
  .refresh-button:hover { background: var(--surface-2); border-color: var(--border-soft); }
  .refresh-button:disabled { cursor: wait; opacity: 0.6; }
  .refresh-status { color: var(--text-secondary); font-size: 12px; }
  .theme-toggle {
    background: var(--surface-1); border: 1px solid var(--border);
    border-radius: 999px; padding: 6px 12px; color: var(--text-secondary);
    font-size: 12px; cursor: pointer; transition: var(--transition);
  }
  .theme-toggle:hover { background: var(--surface-2); color: var(--text-primary); }

  /* Assistant chat */
  .assistant-panel { display: grid; gap: 14px; }
  .assistant-messages {
    min-height: 80px; max-height: 440px; overflow: auto;
    display: grid; gap: 10px; padding: 4px;
  }
  .assistant-message {
    padding: 14px 18px; border-radius: 18px; font-size: 14px; line-height: 1.6;
    animation: assistant-fadeIn 0.3s ease both;
  }
  @keyframes assistant-fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .assistant-message-user {
    background: var(--gradient-1); color: #fff;
    margin-left: 12%; border-radius: 18px 6px 18px 18px;
  }
  .assistant-message-assistant {
    background: var(--surface-2); border: 1px solid var(--border-soft);
    margin-right: 8%; border-radius: 6px 18px 18px 18px;
  }
  .assistant-message strong { display: block; font-size: 11px; margin-bottom: 4px; }
  .assistant-message-assistant strong { color: var(--series-1); }
  .assistant-form { display: flex; gap: 8px; }
  .assistant-form input {
    flex: 1; min-width: 0; font: inherit; padding: 10px 14px;
    border: 1px solid var(--border); border-radius: 10px;
    background: var(--surface-1); color: var(--text-primary); transition: var(--transition);
  }
  .assistant-form input:focus { outline: 2px solid var(--series-1); outline-offset: 1px; }
  .assistant-confirmation {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 12px 16px; border: 1px solid var(--series-4); border-radius: 10px;
    font-size: 13px; background: rgba(237, 161, 0, 0.08);
  }
  .assistant-confirmation[hidden] { display: none; }

  /* Assistant launcher & modal */
  .assistant-launcher {
    position: fixed; right: 24px; bottom: 24px; z-index: 900;
    border: none; border-radius: 999px; padding: 12px 20px;
    background: var(--gradient-1); color: #fff; font: inherit;
    font-size: 13px; font-weight: 700;
    box-shadow: 0 8px 24px rgba(42, 120, 214, 0.35); cursor: pointer;
    transition: var(--transition);
  }
  .assistant-launcher:hover { filter: brightness(1.08); transform: translateY(-1px); }
  .assistant-modal[hidden] { display: none; }
  .assistant-modal-card { width: min(720px, 100%); border-radius: var(--radius); }
  .assistant-modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .assistant-modal-header h2 { margin: 0; font-size: 18px; }
  .assistant-close {
    border: 0; background: transparent; color: var(--text-secondary);
    font-size: 22px; line-height: 1; cursor: pointer; padding: 4px 8px; transition: var(--transition);
  }
  .assistant-close:hover { color: var(--text-primary); background: var(--surface-2); border-radius: 6px; }

  /* Thinking indicator */
  .assistant-message-thinking {
    background: var(--surface-1); border: 1px solid var(--border-soft);
    color: var(--text-secondary);
  }
  .assistant-thinking { display: inline-flex; align-items: center; gap: 3px; font-size: 13px; }
  .assistant-thinking-dot {
    width: 5px; height: 5px; border-radius: 50%; background: var(--text-muted);
    animation: pulse 1.4s infinite ease-in-out both;
  }
  .assistant-thinking-dot:nth-child(1) { animation-delay: -0.32s; }
  .assistant-thinking-dot:nth-child(2) { animation-delay: -0.16s; }
  @keyframes pulse { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }

  /* Markdown rendering for assistant messages */
  .assistant-message-assistant code.assistant-code {
    background: rgba(42, 120, 214, 0.12); padding: 2px 6px; border-radius: 4px;
    font-family: SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace; font-size: 12.5px;
  }
  .assistant-message-assistant pre.assistant-pre {
    background: #1e1e1e; color: #d4d4d4; padding: 14px; border-radius: 10px;
    font-family: SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace; font-size: 12px;
    overflow-x: auto; margin: 10px 0; line-height: 1.5;
  }
  .assistant-message-assistant pre.assistant-pre code { background: none; color: inherit; padding: 0; }
  .assistant-message-assistant strong.assistant-bold { font-weight: 650; }
  .assistant-message-assistant em { font-style: italic; }
  .assistant-message-assistant a { color: var(--series-1); font-weight: 500; }
  .assistant-message-assistant h1, .assistant-message-assistant h2, .assistant-message-assistant h3 {
    font-size: 15px; font-weight: 650; margin: 12px 0 6px;
  }
  .assistant-message-assistant ul.assistant-list, .assistant-message-assistant ol.assistant-list {
    padding-left: 20px; margin: 6px 0;
  }
  .assistant-message-assistant li { margin: 3px 0; }
  .assistant-image { max-width: 100%; border-radius: 10px; margin: 12px 0; box-shadow: 0 4px 12px var(--shadow); }
  .assistant-chart { margin: 14px 0; }
  .assistant-p { margin: 6px 0; }
  .assistant-heading { font-size: 15px; font-weight: 700; margin: 12px 0 4px; color: var(--text-primary); }
  .assistant-hr { height: 1px; background: var(--border); margin: 10px 0; }
  .assistant-chart-wrap {
    padding: 14px 14px 6px; border: 1px solid var(--border-soft); border-radius: var(--radius-card);
    background: var(--surface-1); box-shadow: 0 2px 10px var(--shadow);
  }
  .assistant-chart-title { font-size: 14px; font-weight: 700; margin: 0 2px 4px; color: var(--text-primary); }
  .assistant-chart-subtitle { color: var(--text-muted); font-weight: 500; font-size: 12px; }
  .assistant-chart .chart-legend { margin: 2px 0 6px; }
  .assistant-bar {
    animation: assistantBarGrow 0.55s cubic-bezier(0.22, 0.9, 0.3, 1) both;
    transform-box: fill-box; transform-origin: 50% 100%;
  }
  @keyframes assistantBarGrow { from { transform: scaleY(0); opacity: 0.4; } to { transform: scaleY(1); opacity: 1; } }
  .assistant-bar-label { animation: assistantLabelIn 0.4s ease both; }
  @keyframes assistantLabelIn { from { opacity: 0; } to { opacity: 1; } }

  @media (prefers-color-scheme: dark) {
    .assistant-message-thinking { background: var(--surface-2); }
    .assistant-message-assistant code.assistant-code { background: rgba(255,255,255,0.12); }
  }
  @media (max-width: 600px) {
    .assistant-form { flex-direction: column; }
    .assistant-confirmation { align-items: flex-start; flex-direction: column; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="dashboard-header">
    <div class="hero-copy">
      <h1>Engineering Delivery &amp; AI Insights</h1>
      <p class="meta hero-sub">Generated ${escapeHtml(generatedAt.slice(0, 16)).replace('T', ' ')} UTC · Select release(s) below — everything recalculates instantly, nothing here is a performance score.</p>
    </div>
    <div class="dashboard-actions">
      <button id="dashboard-refresh" class="refresh-button" type="button">Refresh dashboard</button>
      <span id="dashboard-refresh-status" class="refresh-status"></span>
    </div>
  </header>

  <button id="assistant-launcher" class="assistant-launcher" type="button" aria-haspopup="dialog" aria-controls="assistant-modal">Ask assistant</button>
  <div id="assistant-modal" class="modal-backdrop assistant-modal" role="dialog" aria-modal="true" aria-labelledby="assistant-modal-title" hidden>
    <div class="modal-card assistant-modal-card">
      <div class="assistant-modal-header">
        <h2 id="assistant-modal-title">Engineering data assistant</h2>
        <button id="assistant-close" class="assistant-close" type="button" aria-label="Close assistant">&times;</button>
      </div>
      <div class="assistant-panel">
        <div id="assistant-messages" class="assistant-messages"></div>
        <div id="assistant-confirmation" class="assistant-confirmation" hidden></div>
        <form id="assistant-form" class="assistant-form">
          <input id="assistant-input" type="text" autocomplete="off" placeholder="Ask about releases, tickets, points, PRs, or Jira updates" />
          <button id="assistant-send" class="refresh-button" type="submit">Ask</button>
        </form>
      </div>
    </div>
  </div>

  <div class="section">
    <div id="release-picker" class="release-picker"></div>
  </div>

  <div class="section">
    <h2>1. Release Summary</h2>
    <div id="release-summary"></div>
  </div>

  <div class="section">
    <h2>2. Story Points vs. Actual Points by Release</h2>
    <p class="caveat">Compare planned and delivered points across the selected releases. Use the developer selector to view the whole team or one developer.</p>
    <div id="release-point-comparison" class="card"></div>
  </div>

  <div class="section">
    <h2>3. Release Progress Over Time</h2>
    <p class="caveat">Cumulative delivery against the release's total planned SP — shows whether work is landing steadily or bunching up toward the end.</p>
    <div id="release-progress"></div>
  </div>

  <div class="section two-col">
    <div class="card">
      <h2>4. Ticket Status Breakdown</h2>
      <div id="ticket-status-breakdown"></div>
    </div>
    <div class="card">
      <h2>5. Issue Type Breakdown</h2>
      <div id="issue-type-breakdown"></div>
    </div>
  </div>

  <div class="section">
    <h2>6. Engineering Activity Trend</h2>
    <p class="caveat">Descriptive only — whether the team was active throughout the release or activity was concentrated in bursts. Not an activity score.</p>
    <div id="engineering-activity-trend"></div>
  </div>

  <div class="section">
    <h2>7. PR Activity Trend</h2>
    <div id="pr-activity-trend"></div>
  </div>

  <div class="section">
    <h2>8. Delivery Flow: In Progress → Code Review</h2>
    <div id="cycle-time"></div>
  </div>

  <div class="section">
    <h2>9. Developer Delivery</h2>
    <p class="meta" style="margin-top:-6px;">Click a row to see that developer's tickets below. Delivered AP is the primary delivery metric; Planned SP is workload context.</p>
    <div id="developer-delivery"></div>
  </div>

  <div class="section">
    <h2>10. Developer Details</h2>
    <div id="developer-details"></div>
  </div>

  <div class="section">
    <h2>11. All Release Tickets</h2>
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
<script>
${assistantSource}
</script>
</body>
</html>`;
}
