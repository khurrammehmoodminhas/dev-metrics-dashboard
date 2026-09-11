import { requireDashboardAuth } from './_auth.js';
import { getLatestDashboard } from '../src/refreshDashboard.js';

export default async function handler(req, res) {
  if (!requireDashboardAuth(req, res)) return;
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' });
    res.end();
    return;
  }

  try {
    const bundle = await getLatestDashboard();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
    });
    res.end(JSON.stringify(bundle));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
}
