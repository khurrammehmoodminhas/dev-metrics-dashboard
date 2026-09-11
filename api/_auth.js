import { timingSafeEqual } from 'node:crypto';

function credentialsConfigured() {
  return Boolean(process.env.DASHBOARD_USERNAME && process.env.DASHBOARD_PASSWORD);
}

function matchesExpectedCredentials(header) {
  if (!header?.startsWith('Basic ')) return false;

  const supplied = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const expected = `${process.env.DASHBOARD_USERNAME}:${process.env.DASHBOARD_PASSWORD}`;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);

  return suppliedBuffer.length === expectedBuffer.length
    && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function isDashboardAuthorized(req) {
  return credentialsConfigured()
    ? matchesExpectedCredentials(req.headers.authorization)
    : !process.env.VERCEL;
}

/**
 * Keep the public Vercel deployment private by default. Locally, credentials
 * are optional so `npm run live` remains convenient.
 */
export function requireDashboardAuth(req, res) {
  if (!credentialsConfigured()) {
    if (!process.env.VERCEL) return true;
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD in Vercel.' }));
    return false;
  }

  if (isDashboardAuthorized(req)) return true;

  res.writeHead(401, {
    'Content-Type': 'text/plain; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="Engineering Delivery Dashboard"',
  });
  res.end('Authentication required.');
  return false;
}
