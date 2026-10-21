import { timingSafeEqual } from 'node:crypto';
import { getConfig } from '../config/index.js';

function credentials() {
  const { dashboardUsername, dashboardPassword } = getConfig().server;
  return dashboardUsername && dashboardPassword ? { dashboardUsername, dashboardPassword } : null;
}

function matchesExpectedCredentials(header, creds) {
  if (!header?.startsWith('Basic ')) return false;

  const supplied = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const expected = `${creds.dashboardUsername}:${creds.dashboardPassword}`;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);

  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function isDashboardAuthorized(req) {
  const creds = credentials();
  return creds ? matchesExpectedCredentials(req.headers.authorization, creds) : !getConfig().server.isVercel;
}

/**
 * Keeps a public deployment private by default: on Vercel, DASHBOARD_USERNAME /
 * DASHBOARD_PASSWORD are mandatory and every route (including the Jira write
 * API) sits behind HTTP Basic Auth. Locally, credentials are optional so
 * `npm run dev` stays convenient — the local server binds to loopback unless
 * HOST says otherwise — and enforced when set.
 */
export function requireDashboardAuth(req, res) {
  const creds = credentials();
  if (!creds) {
    if (!getConfig().server.isVercel) return true;
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD in the deployment environment.' }));
    return false;
  }

  if (isDashboardAuthorized(req)) return true;

  res.writeHead(401, {
    'Content-Type': 'text/plain; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="Dev Metrics Dashboard"',
  });
  res.end('Authentication required.');
  return false;
}
