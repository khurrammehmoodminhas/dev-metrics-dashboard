import { requireDashboardAuth } from './_auth.js';
import { getLatestDashboard } from '../src/refreshDashboard.js';
import {
  addReviewLog,
  deleteReviewLog,
  getReviewLogsMap,
  updateReviewLog,
} from '../src/reviews/service.js';

const MAX_BODY_BYTES = 64 * 1024;

function readJsonBody(req) {
  // Vercel may already parse JSON into req.body; fall back to streaming for local adapters.
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  return new Promise((resolve, reject) => {
    let body = '';
    let bodyBytes = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      bodyBytes += Buffer.byteLength(chunk);
      if (bodyBytes > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        return resolve(JSON.parse(body));
      } catch (error) {
        return reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (!requireDashboardAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const logs = await getReviewLogsMap();
      sendJson(res, 200, { ok: true, review_logs: logs });
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'GET, POST' });
      res.end();
      return;
    }

    const body = await readJsonBody(req);
    const action = String(body.action ?? 'add').trim().toLowerCase();
    const bundle = await getLatestDashboard();

    if (action === 'add') {
      const result = await addReviewLog({
        issueKey: body.issueKey,
        reviewer: body.reviewer,
        timeSpent: body.time_spent ?? body.timeSpent,
        bundle,
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (action === 'update') {
      const result = await updateReviewLog({
        issueKey: body.issueKey,
        logId: body.id,
        reviewer: body.reviewer,
        timeSpent: body.time_spent ?? body.timeSpent,
        bundle,
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (action === 'delete') {
      const result = await deleteReviewLog({
        issueKey: body.issueKey,
        logId: body.id,
        bundle,
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    sendJson(res, 400, { ok: false, error: `Unknown review action: ${action}` });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}
