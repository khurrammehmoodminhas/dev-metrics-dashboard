import { updateJiraIssueField } from '../../src/fetch/jira.js';
import { requireDashboardAuth } from '../_auth.js';
import { refreshDashboard } from '../../src/refreshDashboard.js';

const MAX_BODY_BYTES = 64 * 1024;

function readJsonBody(req) {
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

export default async function handler(req, res) {
  if (!requireDashboardAuth(req, res)) return;
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' });
    res.end();
    return;
  }

  try {
    const issueKeyParam = Array.isArray(req.query?.issueKey) ? req.query.issueKey[0] : req.query?.issueKey;
    if (!issueKeyParam) throw new Error('Ticket key is missing from the request URL.');
    const issueKey = decodeURIComponent(issueKeyParam);
    const body = await readJsonBody(req);
    const updates = body?.updates ?? body;
    const entries = Object.entries(updates || {});
    if (!entries.length) throw new Error('No Jira fields were supplied.');

    for (const [field, value] of entries) {
      // Jira updates must run serially so a failed field stops the request.
      // eslint-disable-next-line no-await-in-loop
      await updateJiraIssueField(issueKey, field, value);
    }

    const bundle = await refreshDashboard();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: true,
      ticket: bundle.tickets?.[issueKey] ?? null,
      updatedFields: entries.map(([field, value]) => ({ field, value })),
    }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
}
