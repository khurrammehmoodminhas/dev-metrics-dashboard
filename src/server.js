// Local development / self-hosted server. One process: generates the dashboard
// on boot, refreshes it every minute, and serves the same routes the Vercel
// functions in api/ expose — through the shared handlers in src/http.
import http from 'node:http';
import { getConfig, ConfigError } from './config/index.js';
import { generateDashboard } from './index.js';
import { renderDashboard } from './dashboard/render.js';
import { requireDashboardAuth } from './http/auth.js';
import { HttpError, readJsonBody, parseReleasesQuery } from './http/body.js';
import { sendJson, sendHtml, sendMethodNotAllowed, sendResult } from './http/respond.js';
import { handleTicketUpdate, handleReviews, handleAssistant, handleRefresh, errorPage } from './http/handlers.js';
import { sendRefreshStream } from './http/refreshStream.js';
import { log, warn } from './utils/logger.js';

const REFRESH_INTERVAL_MS = 60 * 1000;

let lastBundle = null;
let lastDashboardHtml = '';
let lastError = null;

async function refreshData({ onProgress } = {}) {
  try {
    const bundle = await generateDashboard({ onProgress });
    lastBundle = bundle;
    lastDashboardHtml = renderDashboard(bundle);
    lastError = null;
    log(`Live refresh complete at ${bundle.generated_at}`);
    return bundle;
  } catch (error) {
    lastError = error;
    warn(`Live refresh failed: ${error.message}`);
    return null;
  }
}

async function getBundle() {
  if (lastBundle) return lastBundle;
  const bundle = await refreshData();
  if (!bundle) throw lastError ?? new Error('Dashboard has not been generated yet.');
  return bundle;
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  if (pathname === '/health' || pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      generatedAt: lastBundle?.generated_at ?? null,
      lastError: lastError?.message ?? null,
    });
  }

  // Same Basic Auth as the Vercel deployment when credentials are set.
  if (!requireDashboardAuth(req, res)) return;

  const ticketMatch = /^\/api\/tickets\/([^/]+)$/.exec(pathname);
  if (ticketMatch) {
    if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
    const body = await readJsonBody(req);
    return sendResult(
      res,
      await handleTicketUpdate({ issueKey: decodeURIComponent(ticketMatch[1]), body, refresh: refreshData }),
    );
  }

  if (pathname === '/api/reviews') {
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    const result = await handleReviews({ method: req.method, body, getBundle });
    if (result.status === 405) return sendMethodNotAllowed(res, result.allow);
    return sendResult(res, result);
  }

  if (pathname === '/api/assistant') {
    if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
    const body = await readJsonBody(req);
    return sendResult(res, await handleAssistant({ body, getBundle, refresh: refreshData }));
  }

  if (pathname === '/api/refresh') {
    if (req.method !== 'GET' && req.method !== 'POST') return sendMethodNotAllowed(res, 'GET, POST');
    if (url.searchParams.get('stream') === '1') {
      return sendRefreshStream(res, (onProgress) => refreshData({ onProgress }));
    }
    return sendResult(res, await handleRefresh({ refresh: refreshData }));
  }

  if (pathname === '/bundle.json' || pathname === '/api/bundle') {
    return sendJson(res, 200, lastBundle ?? {});
  }

  if (pathname === '/') {
    const releases = parseReleasesQuery(req.url);
    if (releases.length > 0) {
      try {
        const bundle = await generateDashboard({ releases, writeOutput: false });
        return sendHtml(res, 200, renderDashboard(bundle));
      } catch (error) {
        warn(`Failed to generate dashboard for query releases: ${error.message}`);
        return sendHtml(res, 500, errorPage(error));
      }
    }
    if (lastDashboardHtml) return sendHtml(res, 200, lastDashboardHtml);
    if (lastError) return sendHtml(res, 500, errorPage(lastError));
    return sendHtml(res, 200, '<p>Dashboard is still warming up — refresh in a moment.</p>');
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
  return undefined;
}

async function bootstrap() {
  const config = getConfig();
  await refreshData();
  setInterval(() => {
    refreshData().catch(() => {});
  }, REFRESH_INTERVAL_MS);

  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      if (error instanceof HttpError) {
        if (!res.headersSent) sendJson(res, error.status, { ok: false, error: error.message });
        return;
      }
      warn(`Unhandled error on ${req.method} ${req.url}: ${error.stack ?? error.message}`);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: error.message });
      else res.end();
    });
  });

  const port = config.server.port;
  // Loopback by default: the local server can write to Jira with the team's
  // token, so exposing it on the LAN is an explicit choice (HOST=0.0.0.0).
  const host = config.server.host;
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      warn(`Port ${port} is already in use; trying ${port + 1}`);
      server.close(() => {
        server.listen(port + 1, host, () => log(`Dashboard server listening on http://${host}:${port + 1}`));
      });
      return;
    }
    throw error;
  });

  server.listen(port, host, () => {
    log(`Dashboard server listening on http://${host}:${port}`);
  });
}

try {
  await bootstrap();
} catch (error) {
  if (error instanceof ConfigError) {
    warn(error.message);
  } else {
    warn(error.stack ?? error.message);
  }
  process.exitCode = 1;
}
