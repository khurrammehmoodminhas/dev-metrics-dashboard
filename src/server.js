import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDashboard } from './index.js';
import { renderDashboard } from './dashboard/render.js';
import { updateJiraIssueField } from './fetch/jira.js';
import { log, warn } from './utils/logger.js';

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

    if (req.url === '/bundle.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(lastBundleJson || '{}');
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
