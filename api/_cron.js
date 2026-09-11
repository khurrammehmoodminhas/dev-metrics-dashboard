import { timingSafeEqual } from 'node:crypto';

export function isCronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const supplied = req.headers.authorization ?? '';
  const expected = `Bearer ${secret}`;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function requireCronAuth(req, res) {
  if (!process.env.CRON_SECRET) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'CRON_SECRET is not set.' }));
    return false;
  }
  if (isCronAuthorized(req)) return true;
  res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Unauthorized cron invocation.' }));
  return false;
}
