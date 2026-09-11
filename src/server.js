import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDashboard } from './index.js';
import { renderDashboard } from './dashboard/render.js';
import { updateJiraIssueField } from './fetch/jira.js';
import { getReviewLogsMap, addReviewLog, updateReviewLog, deleteReviewLog } from './reviews/service.js';
import { log, warn } from './utils/logger.js';
import { answerAssistantQuestion, applyAssistantUpdate } from './ai/assistant.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.join(__dirname, '..', 'data', 'output');
const dashboardPath = path.join(outputRoot, 'dashboard.html');
const bundlePath = path.join(outputRoot, 'bundle.json');

let lastDashboardHtml = '';
let lastBundleJson = '';
let lastGeneratedAt = null;

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function refreshData() {
  try {
    const bundle = await generateDashboard();
    lastDashboardHtml = readIfExists(dashboardPath);
    lastBundleJson = readIfExists(bundlePath);
    lastGeneratedAt = bundle.generated_at;
    log(`Live refresh complete at ${lastGeneratedAt}`);
    return bundle;
  } catch (error) {
    warn(`Live refresh failed: ${error.message}`);
    return null;
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function bootstrap() {
  await refreshData();
  setInterval(() => {
    refreshData().catch(() => {});
  }, 60 * 1000);

  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, generatedAt: lastGeneratedAt }));
      return;
    }

    if (req.method === 'POST' && req.url.match(/^\/api\/tickets\/[^/]+$/)) {
      try {
        const match = req.url.match(/^\/api\/tickets\/([^/]+)$/);
        const issueKey = decodeURIComponent(match[1]);
        const body = await readJsonBody(req);
        const updates = body?.updates ?? body;
        const entries = Object.entries(updates || {});
        if (entries.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'No Jira fields were supplied.' }));
          return;
        }

        for (const [field, value] of entries) {
          await updateJiraIssueField(issueKey, field, value);
        }

        const bundle = await refreshData();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ticket: bundle?.tickets?.[issueKey] ?? null, updatedFields: entries.map(([field, value]) => ({ field, value })) }));
        return;
      } catch (error) {
        warn(`Jira update failed: ${error.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
        return;
      }
    }

    if (req.url === '/api/reviews') {
      try {
        if (req.method === 'GET') {
          const logs = await getReviewLogsMap();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: true, review_logs: logs }));
          return;
        }

        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'GET, POST' });
          res.end();
          return;
        }

        const body = await readJsonBody(req);
        const action = String(body.action ?? 'add').trim().toLowerCase();
        const bundle = JSON.parse(lastBundleJson || '{}');

        if (action === 'add') {
          const result = await addReviewLog({ issueKey: body.issueKey, reviewer: body.reviewer, timeSpent: body.time_spent ?? body.timeSpent, bundle });
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: true, ...result }));
          return;
        }

        if (action === 'update') {
          const result = await updateReviewLog({ issueKey: body.issueKey, logId: body.id, reviewer: body.reviewer, timeSpent: body.time_spent ?? body.timeSpent, bundle });
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: true, ...result }));
          return;
        }

        if (action === 'delete') {
          const result = await deleteReviewLog({ issueKey: body.issueKey, logId: body.id, bundle });
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: true, ...result }));
          return;
        }

        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: `Unknown review action: ${action}` }));
        return;
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/api/assistant') {
      try {
        const body = await readJsonBody(req);
        const bundle = JSON.parse(lastBundleJson || '{}');
        if (body.confirm) {
          const action = await applyAssistantUpdate(body.confirm, bundle, refreshData);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: true, action }));
          return;
        }
        const result = await answerAssistantQuestion(bundle, Array.isArray(body.messages) ? body.messages : []);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }

    if (req.url === '/bundle.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(lastBundleJson || '{}');
      return;
    }

    if (req.method === 'GET' && req.url === '/api/refresh') {
      try {
        const bundle = await refreshData();
        if (!bundle) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: false, error: 'Dashboard refresh failed. Check server logs.' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, generatedAt: bundle.generated_at }));
      } catch (error) {
        warn(`Dashboard refresh failed: ${error.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }

    const [pathOnly, queryString] = req.url.split('?');
    if (pathOnly === '/' && queryString) {
      const params = new URLSearchParams(queryString);
      const releases = params.getAll('releases')
        .flatMap(function (value) { return value.split(','); })
        .map(function (name) { return name.trim(); })
        .filter(function (name) { return name.length > 0; });

      if (releases.length > 0) {
        try {
          const bundle = await generateDashboard({ releases, writeOutput: false });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderDashboard(bundle));
          return;
        } catch (error) {
          warn(`Failed to generate dashboard for query releases: ${error.message}`);
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<p>Failed to load releases ${escapeHtml(releases.join(', '))}: ${escapeHtml(error.message)}</p>`);
          return;
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(lastDashboardHtml || '<p>Dashboard is still warming up...</p>');
  });

  const requestedPort = Number(process.env.PORT || 3000);
  const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 3000;

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      warn(`Port ${port} is already in use; trying ${port + 1}`);
      server.close(() => {
        server.listen(port + 1, () => {
          log(`Live dashboard server listening on http://localhost:${port + 1}`);
        });
      });
      return;
    }
    throw error;
  });

  server.listen(port, () => {
    log(`Live dashboard server listening on http://localhost:${port}`);
  });
}

try {
  await bootstrap();
} catch (error) {
  warn(error.stack ?? error.message);
  process.exitCode = 1;
}
