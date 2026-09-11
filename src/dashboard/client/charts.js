// Pure inline-SVG chart builders. Plain JS, NO import/export — same reason as
// deliveryMath.js/timeSeries.js (inlined verbatim into the dashboard's <script>
// tag). Unlike picker.js this is NOT IIFE-wrapped: its functions stay on the
// global scope on purpose, since picker.js calls into them directly, the same
// relationship picker.js already has with deliveryMath.js/timeSeries.js.
// Knows nothing about tickets/PRs/Jira — consumes only the plain data shapes
// timeSeries.js/deliveryMath.js produce.

// Categorical hues in FIXED order (never reassigned based on which series is
// present, per the dataviz method) — matches this dashboard's existing
// palette slots 1-4 (blue, orange, aqua, yellow), defined as CSS custom
// properties in dashboard/render.js.
const CHART_SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

function chartEscapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

function chartFmtNum(value, digits) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits || 0 });
}

// Chart action buttons SVG icons
const CHART_ICONS = {
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>'
};

// Create chart action buttons HTML
function chartActionsHtml(chartId, svgContent) {
  return `<div class="chart-actions">
    <button class="chart-action-btn chart-expand-btn" data-chart-id="${chartId}" data-svg="${encodeURIComponent(svgContent)}" title="Open in full screen">${CHART_ICONS.expand} Fullscreen</button>
  </div>`;
}

// Open chart in full-screen modal
function openChartFullscreen(svgContent, title) {
  // Remove any existing modal
  const existingModal = document.querySelector('.chart-modal-overlay');
  if (existingModal) existingModal.remove();
  
  const overlay = document.createElement('div');
  overlay.className = 'chart-modal-overlay';
  overlay.innerHTML = `<div class="chart-modal">
    <button class="chart-modal-close">&times;</button>
    <div class="chart-modal-body">
      ${title ? `<h3 style="margin:0 0 16px;">${chartEscapeHtml(title)}</h3>` : ''}
      ${decodeURIComponent(svgContent)}
    </div>
  </div>`;
  
  document.body.appendChild(overlay);
  
  // Close on click
  overlay.querySelector('.chart-modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  
  // Close on Escape key
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    }
  });
}

// Initialize chart action buttons
function initChartActions(container) {
  container.addEventListener('click', function(e) {
    const expandBtn = e.target.closest('.chart-expand-btn');
    
    if (expandBtn) {
      const svgContent = expandBtn.getAttribute('data-svg');
      const title = expandBtn.closest('.card')?.querySelector('h2, h3')?.textContent || 'Chart';
      openChartFullscreen(svgContent, title);
    }
  });
}

/**
 * Multi-series line chart (up to 4 series, one axis — two measures of
 * different scale get two separate charts, never a second y-axis). Each
 * point carries a native <title> tooltip (hover detail without a custom
 * crosshair implementation); only the last point of each line is
 * direct-labeled (selective labeling, not a number on every point); a legend
 * is always shown for 2+ series. `referenceLine` is an optional flat
 * {label, value} dashed horizontal line (e.g. total planned SP).
 */
function buildLineChart(series, options) {
  const opts = options || {};
  const width = opts.width || 640;
  const height = opts.height || 220;
  const padding = { top: 16, right: 16, bottom: 28, left: 8 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const nonEmptySeries = series.filter((s) => s.points && s.points.length > 0);
  if (nonEmptySeries.length === 0) {
    return '<p class="empty-state">No data in this window.</p>';
  }

  const pointCount = nonEmptySeries[0].points.length;
  const allDates = nonEmptySeries[0].points.map((p) => p.date);
  const allValues = nonEmptySeries.flatMap((s) => s.points.map((p) => p.value));
  if (opts.referenceLine) allValues.push(opts.referenceLine.value);
  const maxValue = Math.max(1, ...allValues);

  const xAt = (i) => padding.left + (pointCount <= 1 ? plotWidth / 2 : (i / (pointCount - 1)) * plotWidth);
  const yAt = (value) => padding.top + plotHeight - (value / maxValue) * plotHeight;

  const gridLines = [0, 0.5, 1]
    .map((frac) => {
      const yPos = padding.top + plotHeight * (1 - frac);
      return `<line x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}" class="chart-gridline" />`;
    })
    .join('');

  const refLineSvg = opts.referenceLine
    ? `<line x1="${padding.left}" y1="${yAt(opts.referenceLine.value).toFixed(1)}" x2="${width - padding.right}" y2="${yAt(opts.referenceLine.value).toFixed(1)}" class="chart-reference-line" />
       <text x="${width - padding.right}" y="${(yAt(opts.referenceLine.value) - 4).toFixed(1)}" class="chart-axis-label" text-anchor="end">${chartEscapeHtml(opts.referenceLine.label)}: ${chartFmtNum(opts.referenceLine.value)}</text>`
    : '';

  const seriesSvg = nonEmptySeries
    .map((s, seriesIndex) => {
      const color = CHART_SERIES_COLORS[seriesIndex % CHART_SERIES_COLORS.length];
      const pathD = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`).join(' ');
      const markers = s.points
        .map(
          (p, i) =>
            `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.value).toFixed(1)}" r="2.5" fill="${color}"><title>${chartEscapeHtml(s.name)} — ${chartEscapeHtml(p.date)}: ${chartFmtNum(p.value)}</title></circle>`,
        )
        .join('');
      const lastPoint = s.points[s.points.length - 1];
      const lastX = xAt(s.points.length - 1);
      const lastY = yAt(lastPoint.value);
      return `
        <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        ${markers}
        <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4" fill="var(--surface-1)" stroke="${color}" stroke-width="2" />
        <text x="${Math.min(lastX + 6, width - padding.right - 4).toFixed(1)}" y="${(lastY - 6).toFixed(1)}" class="chart-series-label" fill="${color}" text-anchor="${lastX + 6 > width - padding.right - 60 ? 'end' : 'start'}">${chartEscapeHtml(s.name)}: ${chartFmtNum(lastPoint.value)}</text>
      `;
    })
    .join('');

  const xAxisLabels =
    pointCount > 1
      ? [0, pointCount - 1]
          .map(
            (i) =>
              `<text x="${xAt(i).toFixed(1)}" y="${height - 6}" class="chart-axis-label" text-anchor="${i === 0 ? 'start' : 'end'}">${chartEscapeHtml(allDates[i])}</text>`,
          )
          .join('')
      : `<text x="${xAt(0).toFixed(1)}" y="${height - 6}" class="chart-axis-label" text-anchor="middle">${chartEscapeHtml(allDates[0])}</text>`;

  const legend =
    nonEmptySeries.length > 1
      ? `<div class="chart-legend">${nonEmptySeries
          .map(
            (s, i) =>
              `<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length]}"></span>${chartEscapeHtml(s.name)}</span>`,
          )
          .join('')}</div>`
      : '';

  const svgContent = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="${chartEscapeHtml(opts.ariaLabel || 'Line chart')}">
    ${gridLines}
    ${refLineSvg}
    ${seriesSvg}
    ${xAxisLabels}
  </svg>`;

  const chartId = `chart-${Math.random().toString(36).substr(2, 9)}`;
  return `
    <div class="chart-container" id="${chartId}">
      ${legend}
      ${chartActionsHtml(chartId, svgContent)}
      ${svgContent}
    </div>
  `;
}

/** Grouped bars make the two point measures directly comparable per release. */
function buildReleasePointComparisonChart(rows) {
  if (!rows.length) return '<p class="empty-state">No releases selected.</p>';
  const width = Math.max(640, rows.length * 84);
  const height = 320; // Increased slightly for generous label space
  const padding = { top: 24, right: 20, bottom: 100, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...rows.flatMap((row) => [row.planned_sp || 0, row.delivered_ap || 0]));
  const groupWidth = plotWidth / rows.length;
  const barWidth = Math.max(6, Math.min(22, groupWidth * 0.32));
  const yAt = (value) => padding.top + plotHeight - ((value || 0) / maxValue) * plotHeight;

  const gridLines = [0, 0.5, 1].map((fraction) => {
    const y = padding.top + plotHeight * (1 - fraction);
    const val = chartFmtNum(maxValue * fraction);
    return `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="chart-gridline" />
      <text x="${padding.left - 6}" y="${y + 4}" class="chart-axis-label" text-anchor="end">${val}</text>
    `;
  }).join('');

  const labelY = padding.top + plotHeight + 14; // Position labels just below the bottom axis line

  const bars = rows.map((row, index) => {
    const center = padding.left + groupWidth * index + groupWidth / 2;
    const plannedVal = row.planned_sp || 0;
    const actualVal = row.delivered_ap || 0;
    const plannedY = yAt(plannedVal);
    const actualY = yAt(actualVal);
    const fullLabel = row.release_name;

    return `
      <rect x="${(center - barWidth - 2).toFixed(1)}" y="${plannedY.toFixed(1)}" width="${barWidth}" height="${(padding.top + plotHeight - plannedY).toFixed(1)}" fill="var(--series-1)"><title>${chartEscapeHtml(fullLabel)} — Planned SP: ${chartFmtNum(plannedVal)}</title></rect>
      ${plannedVal > 0 ? `<text x="${(center - barWidth / 2 - 2).toFixed(1)}" y="${(plannedY - 4).toFixed(1)}" class="chart-axis-label" text-anchor="middle" font-size="10">${chartFmtNum(plannedVal)}</text>` : ''}
      
      <rect x="${(center + 2).toFixed(1)}" y="${actualY.toFixed(1)}" width="${barWidth}" height="${(padding.top + plotHeight - actualY).toFixed(1)}" fill="var(--series-2)"><title>${chartEscapeHtml(fullLabel)} — Delivered AP: ${chartFmtNum(actualVal)}</title></rect>
      ${actualVal > 0 ? `<text x="${(center + 2 + barWidth / 2).toFixed(1)}" y="${(actualY - 4).toFixed(1)}" class="chart-axis-label" text-anchor="middle" font-size="10">${chartFmtNum(actualVal)}</text>` : ''}

      <text x="${center.toFixed(1)}" y="${labelY.toFixed(1)}" class="chart-axis-label" text-anchor="end" transform="rotate(-40 ${center.toFixed(1)} ${labelY.toFixed(1)})">${chartEscapeHtml(fullLabel)}</text>
    `;
  }).join('');

  return `
    <div class="chart-container">
      <div class="chart-legend"><span class="chart-legend-item"><span class="chart-legend-swatch" style="background:var(--series-1)"></span>Planned SP</span><span class="chart-legend-item"><span class="chart-legend-swatch" style="background:var(--series-2)"></span>Delivered AP</span></div>
      ${chartActionsHtml('release-point-chart', `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Planned Story Points and delivered Actual Points by release">${gridLines}${bars}</svg>`)}
      <div style="overflow-x:auto"><svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Planned Story Points and delivered Actual Points by release">${gridLines}${bars}</svg></div>
    </div>`;
}

/**
 * 100%-stacked horizontal bar for a small fixed set of status categories
 * (part-to-whole rides on the stacked bar per the dataviz method — donut
 * stays deprioritized). `colorByCategory` maps status_category -> a CSS color
 * (status semantics, e.g. Done -> the good/status-green token).
 */
function buildStatusStackedBar(breakdown, colorByCategory) {
  const total = breakdown.reduce((sum, b) => sum + b.count, 0);
  if (total === 0) {
    return '<p class="empty-state">No tickets in the selected release(s).</p>';
  }

  const segments = breakdown
    .filter((b) => b.count > 0)
    .map((b) => {
      const widthPct = (b.count / total) * 100;
      const color = colorByCategory[b.status_category] || 'var(--text-muted)';
      return `<div class="status-bar-segment" style="width:${widthPct}%;background:${color}"><title>${chartEscapeHtml(b.label)}: ${b.count} (${Math.round(b.percent)}%)</title></div>`;
    })
    .join('');

  const legend = breakdown
    .map((b) => {
      const color = colorByCategory[b.status_category] || 'var(--text-muted)';
      const pct = b.percent === null ? '—' : `${Math.round(b.percent)}%`;
      return `<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${color}"></span>${chartEscapeHtml(b.label)}: ${chartFmtNum(b.count)} (${pct})</span>`;
    })
    .join('');

  return `<div class="status-bar">${segments}</div><div class="chart-legend">${legend}</div>`;
}

/**
 * Single-hue horizontal bar histogram — a fixed-range distribution is a
 * magnitude comparison across ordered buckets, not an identity comparison, so
 * one hue is correct (see the dataviz method's sequential-vs-categorical rule).
 */
function buildHistogramBars(buckets) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const rows = buckets
    .map(
      (b) => `
      <div class="histogram-row">
        <span class="histogram-label">${chartEscapeHtml(b.label)}</span>
        <div class="histogram-track"><div class="histogram-fill" style="width:${(b.count / max) * 100}%"></div></div>
        <span class="histogram-count">${chartFmtNum(b.count)}</span>
      </div>`,
    )
    .join('');
  return `<div class="histogram">${rows}</div>`;
}

/**
 * Attractive, theme-aware grouped bar chart rendered from a tiny spec the
 * assistant can emit inside a ```chart fenced block. Kept on the global scope
 * (charts.js is intentionally not IIFE-wrapped) so the assistant chat and any
 * other consumer can call it. Up to 4 series, one per dashboard palette slot.
 *
 * spec = {
 *   title?: string,        // chart heading
 *   subtitle?: string,     // optional sub-line under the title
 *   categories: string[],  // x-axis labels
 *   series:  [{ name: string, values: number[] }]
 * }
 */
function renderAssistantChart(rawSpec) {
  const spec = rawSpec && typeof rawSpec === 'object' ? rawSpec : {};
  const series = (Array.isArray(spec.series) ? spec.series : [])
    .slice(0, 4)
    .map((sr, i) => ({
      name: sr && String(sr.name ?? '').trim() || `Series ${i + 1}`,
      values: Array.isArray(sr && sr.values) ? sr.values.map((v) => Number(v) || 0) : [],
    }));

  const categories = (Array.isArray(spec.categories) ? spec.categories : []).map((c) => String(c ?? ''));
  const maxCount = Math.max(1, categories.length, ...series.map((s) => s.values.length));
  while (categories.length < maxCount) categories.push('');
  for (const s of series) while (s.values.length < maxCount) s.values.push(0);

  if (series.length === 0 || !series.some((s) => s.values.some((v) => v > 0))) {
    return '<p class="empty-state">No data to chart.</p>';
  }

  const color = (i) => CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length];

  const width = Math.max(480, maxCount * 90);
  const height = 210;
  const padding = { top: 30, right: 20, bottom: 42, left: 44 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...series.flatMap((s) => s.values));
  const yAt = (v) => padding.top + plotH - (v / maxValue) * plotH;
  const groupW = plotW / maxCount;
  const barW = Math.max(5, Math.min(20, (groupW * 0.72) / series.length));
  const gap = series.length > 1 ? 3 : 0;

  const gridlines = [0, 0.25, 0.5, 0.75, 1]
    .map((frac) => {
      const y = padding.top + plotH * (1 - frac);
      return `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}" class="chart-gridline" />
        <text x="${padding.left - 6}" y="${y + 4}" class="chart-axis-label" text-anchor="end">${chartFmtNum(maxValue * frac)}</text>`;
    })
    .join('');

  const barGroups = categories.map((cat, ci) => {
    const groupCenter = padding.left + groupW * ci + groupW / 2;
    const totalW = series.length * barW + (series.length - 1) * gap;
    const groupStart = groupCenter - totalW / 2;
    return series.map((s, si) => {
      const val = s.values[ci] || 0;
      if (val <= 0) return '';
      const x = groupStart + si * (barW + gap);
      const y = yAt(val);
      const h = padding.top + plotH - y;
      const r = Math.min(4, barW / 2, h / 2);
      const delay = (ci * series.length + si) * 0.05;
      return `
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="${r.toFixed(1)}" fill="${color(si)}" class="assistant-bar" style="animation-delay:${delay.toFixed(2)}s">
          <title>${chartEscapeHtml(cat || '')} ${chartEscapeHtml(s.name)}: ${chartFmtNum(val)}</title>
        </rect>
        <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" class="chart-axis-label assistant-bar-label" text-anchor="middle" font-size="10" style="animation-delay:${(delay + 0.25).toFixed(2)}s">${chartFmtNum(val)}</text>`;
    }).join('');
  }).join('');

  const catLabels = categories.map((cat, ci) => {
    const groupCenter = padding.left + groupW * ci + groupW / 2;
    const cx = Math.min(Math.max(groupCenter, padding.left + 14), width - padding.right - 14);
    return `<text x="${cx.toFixed(1)}" y="${height - 8}" class="chart-axis-label" text-anchor="middle">${chartEscapeHtml(cat || '')}</text>`;
  }).join('');

  const legend = `<div class="chart-legend">${series
    .map((s, i) => `<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${color(i)}"></span>${chartEscapeHtml(s.name)}</span>`)
    .join('')}</div>`;

  const title = spec.title
    ? `<div class="assistant-chart-title">${chartEscapeHtml(String(spec.title))}${spec.subtitle ? `<span class="assistant-chart-subtitle"> ${chartEscapeHtml(String(spec.subtitle))}</span>` : ''}</div>`
    : '';

  const svgContent = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="${chartEscapeHtml(String(spec.title || 'Assistant chart'))}">${gridlines}${barGroups}${catLabels}</svg>`;
  const chartId = `assistant-chart-${Math.random().toString(36).substr(2, 9)}`;

  return `<div class="assistant-chart-wrap" id="${chartId}">${title}${legend}${chartActionsHtml(chartId, svgContent)}<div style="overflow-x:auto">
    ${svgContent}
  </div></div>`;
}