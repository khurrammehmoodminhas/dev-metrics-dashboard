// Transport-agnostic request handlers shared by the local Node server
// (src/server.js) and the Vercel functions (api/*.js). Each returns a plain
// `{ status, json }` or `{ status, html }` result so both transports stay thin
// and every behaviour here is testable without sockets.

import { getConfig } from '../config/index.js';
import { EDITABLE_FIELDS, normalizeFieldName, updateJiraIssueField } from '../fetch/jira.js';
import { assertIssueKey } from '../fetch/jiraClient.js';
import { addReviewLog, deleteReviewLog, getReviewLogsMap, updateReviewLog } from '../reviews/service.js';
import { answerAssistantQuestion, applyAssistantUpdate } from '../ai/assistant.js';
import { renderDashboard } from '../dashboard/render.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { warn } from '../utils/logger.js';

const MAX_FIELDS_PER_UPDATE = 10;

function failure(status, message) {
  return { status, json: { ok: false, error: message } };
}

/** Errors from validation are 400s; anything else is a 500 with the message preserved. */
function statusFor(error) {
  if (error?.name === 'JiraApiError' && error.status === 404) return 404;
  if (error?.name === 'JiraApiError') return 502;
  if (error?.name === 'GitHubApiError') return 502;
  return 500;
}

/**
 * POST /api/tickets/:issueKey  body: { updates: { field: value } }
 * Applies each field serially so a failure stops before later fields are
 * touched; the response reports exactly which fields were applied.
 */
export async function handleTicketUpdate({ issueKey, body, refresh, config = getConfig() }) {
  if (!config.features.jiraEditing) return failure(403, 'Jira editing is disabled for this deployment.');

  let key;
  try {
    key = assertIssueKey(issueKey);
  } catch (error) {
    return failure(400, error.message);
  }
  // Scope writes to this deployment's project: the Jira account may be able
  // to edit other projects too.
  if (!key.startsWith(`${config.jira.projectKey}-`))
    return failure(403, `Only ${config.jira.projectKey} tickets can be edited from this dashboard.`);

  const updates = body?.updates && typeof body.updates === 'object' ? body.updates : body;
  const entries = Object.entries(updates || {}).filter(([field]) => field !== 'updates');
  if (entries.length === 0) return failure(400, 'No Jira fields were supplied.');
  if (entries.length > MAX_FIELDS_PER_UPDATE)
    return failure(400, `At most ${MAX_FIELDS_PER_UPDATE} fields can be updated per request.`);

  const unknown = entries
    .map(([field]) => normalizeFieldName(field))
    .filter((field) => !EDITABLE_FIELDS.includes(field));
  if (unknown.length)
    return failure(400, `These fields cannot be edited through the dashboard: ${unknown.join(', ')}.`);

  const applied = [];
  for (const [field, value] of entries) {
    try {
      const result = await updateJiraIssueField(key, field, value, config);
      applied.push({ field: result.field, value: result.value });
    } catch (error) {
      warn(`Jira update failed on ${key}.${field}: ${error.message}`);
      return {
        status: statusFor(error),
        json: { ok: false, error: error.message, appliedFields: applied, failedField: normalizeFieldName(field) },
      };
    }
  }

  let ticket = null;
  try {
    const bundle = await refresh();
    ticket = bundle?.tickets?.[key] ?? null;
  } catch (error) {
    // The Jira write succeeded; a refresh failure must not be reported as a failed edit.
    warn(`Dashboard refresh after updating ${key} failed: ${error.message}`);
  }
  return { status: 200, json: { ok: true, ticket, updatedFields: applied } };
}

/** GET|POST /api/reviews */
export async function handleReviews({ method, body, getBundle, config = getConfig() }) {
  if (!config.features.reviewLogging) return failure(403, 'Code-review logging is disabled for this deployment.');
  try {
    if (method === 'GET') {
      return { status: 200, json: { ok: true, review_logs: await getReviewLogsMap() } };
    }
    if (method !== 'POST')
      return { status: 405, json: { ok: false, error: 'Method not allowed.' }, allow: 'GET, POST' };

    const action = String(body?.action ?? 'add')
      .trim()
      .toLowerCase();
    const bundle = await getBundle();
    const common = {
      issueKey: body?.issueKey,
      reviewer: body?.reviewer,
      timeSpent: body?.time_spent ?? body?.timeSpent,
      bundle,
    };

    if (action === 'add') return { status: 200, json: { ok: true, ...(await addReviewLog(common)) } };
    if (action === 'update')
      return { status: 200, json: { ok: true, ...(await updateReviewLog({ ...common, logId: body?.id })) } };
    if (action === 'delete')
      return {
        status: 200,
        json: { ok: true, ...(await deleteReviewLog({ issueKey: body?.issueKey, logId: body?.id, bundle })) },
      };
    return failure(400, `Unknown review action: ${action}`);
  } catch (error) {
    warn(`Review log request failed: ${error.message}`);
    return failure(error.name === 'JiraApiError' ? statusFor(error) : 400, error.message);
  }
}

/** POST /api/assistant  body: { messages } | { confirm } */
export async function handleAssistant({ body, getBundle, refresh, config = getConfig() }) {
  if (!config.features.assistant) return failure(403, 'The assistant is not configured (AI_API_KEY is unset).');
  try {
    const bundle = await getBundle();
    if (body?.confirm) {
      const action = await applyAssistantUpdate(body.confirm, bundle, refresh);
      return { status: 200, json: { ok: true, action } };
    }
    const result = await answerAssistantQuestion(bundle, Array.isArray(body?.messages) ? body.messages : []);
    return { status: 200, json: { ok: true, ...result } };
  } catch (error) {
    warn(`Assistant request failed: ${error.message}`);
    return failure(statusFor(error), error.message);
  }
}

/** GET /api/refresh */
export async function handleRefresh({ refresh, timeoutMs = 120000 }) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Dashboard refresh timed out.')), timeoutMs);
  });
  try {
    const bundle = await Promise.race([refresh(), timeout]);
    if (!bundle) return failure(500, 'Dashboard refresh failed. Check server logs.');
    return { status: 200, json: { ok: true, generatedAt: bundle.generated_at, warnings: bundle.warnings ?? [] } };
  } catch (error) {
    warn(`Dashboard refresh failed: ${error.message}`);
    return failure(statusFor(error), error.message);
  } finally {
    clearTimeout(timer);
  }
}

export async function handleDashboardPage({ getBundle }) {
  try {
    const bundle = await getBundle();
    return { status: 200, html: renderDashboard(bundle) };
  } catch (error) {
    warn(`Failed to render dashboard: ${error.message}`);
    return { status: 500, html: errorPage(error) };
  }
}

/** A minimal, readable error page — the most common cause is configuration. */
export function errorPage(error) {
  const message = escapeHtml(error?.message ?? 'Unknown error');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dashboard error</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 16px;color:#1a1a1a}pre{white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:6px}</style></head>
<body><h1>Dashboard could not be generated</h1><pre>${message}</pre>
<p>Check the server logs, <code>.env</code> and <code>docs/TROUBLESHOOTING.md</code>. Run <code>npm run check</code> to validate configuration and credentials.</p></body></html>`;
}
