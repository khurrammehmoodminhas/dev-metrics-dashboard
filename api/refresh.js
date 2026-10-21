import { guarded } from './_guard.js';
import { isCronAuthorized } from './_cron.js';
import { isDashboardAuthorized, requireDashboardAuth } from './_auth.js';
import { refreshDashboard } from '../src/refreshDashboard.js';
import { sendMethodNotAllowed, sendResult } from '../src/http/respond.js';
import { handleRefresh } from '../src/http/handlers.js';
import { sendRefreshStream } from '../src/http/refreshStream.js';

export default guarded(async function handler(req, res) {
  // Vercel Cron authenticates with CRON_SECRET; the dashboard's Refresh button
  // reuses the browser's Basic Auth session.
  if (!isCronAuthorized(req) && !isDashboardAuthorized(req) && !requireDashboardAuth(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return sendMethodNotAllowed(res, 'GET, POST');
  if (new URL(req.url, 'https://dashboard.invalid').searchParams.get('stream') === '1') {
    return sendRefreshStream(res, (onProgress) => refreshDashboard({ onProgress }));
  }
  sendResult(res, await handleRefresh({ refresh: refreshDashboard }));
});
