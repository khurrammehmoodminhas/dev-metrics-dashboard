import { generateDashboard } from '../src/index.js';
import { renderDashboard } from '../src/dashboard/render.js';
import { requireDashboardAuth } from './_auth.js';
import { getLatestDashboard } from '../src/refreshDashboard.js';

function releasesFromRequest(req) {
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.getAll('releases')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

export default async function handler(req, res) {
  if (!requireDashboardAuth(req, res)) return;
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' });
    res.end();
    return;
  }

  try {
    const releases = releasesFromRequest(req);
    const bundle = releases.length
      ? await generateDashboard({ releases, writeOutput: false })
      : await getLatestDashboard();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
    });
    res.end(renderDashboard(bundle));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<p>Failed to generate dashboard: ${escapeHtml(error.message)}</p>`);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
