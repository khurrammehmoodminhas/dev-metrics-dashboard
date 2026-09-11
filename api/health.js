import { requireDashboardAuth } from './_auth.js';

export default function handler(req, res) {
  if (!requireDashboardAuth(req, res)) return;
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ ok: true }));
}
