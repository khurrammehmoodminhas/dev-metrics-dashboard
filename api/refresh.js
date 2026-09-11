import { refreshDashboard } from '../src/refreshDashboard.js';
import { isCronAuthorized } from './_cron.js';
import { isDashboardAuthorized, requireDashboardAuth } from './_auth.js';

const REFRESH_TIMEOUT_MS = 120000;

export default async function handler(req, res) {
  // Vercel Cron uses CRON_SECRET; the visible dashboard button uses the
  // already-authenticated dashboard session instead.
  if (!isCronAuthorized(req) && !isDashboardAuthorized(req) && !requireDashboardAuth(req, res)) return;
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' });
    res.end();
    return;
  }

  try {
    const bundle = await Promise.race([
      refreshDashboard(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Dashboard refresh timed out')), REFRESH_TIMEOUT_MS),
      ),
    ]);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, generatedAt: bundle.generated_at }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
}
