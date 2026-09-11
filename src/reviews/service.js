import { postJiraComment } from '../fetch/jira.js';
import {
  createReviewLogId,
  listLogsForIssue,
  readReviewLogStore,
  writeReviewLogStore,
} from '../cache/reviewLogs.js';

function normalizeReviewer(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
}

function normalizeTimeSpent(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 40);
}

function normalizeIssueKey(value) {
  return String(value ?? '').trim().slice(0, 40);
}

export function formatReviewComment(reviewer, timeSpent) {
  return `${reviewer} spent ${timeSpent} on code review`;
}

function assertTicketExists(bundle, issueKey) {
  if (!bundle?.tickets?.[issueKey]) {
    throw new Error(`Ticket ${issueKey} is not present in the current dashboard data.`);
  }
}

/**
 * Returns a plain { [issueKey]: ReviewLog[] } map for embedding in the dashboard bundle.
 */
export async function getReviewLogsMap() {
  const store = await readReviewLogStore();
  return store.logs_by_issue ?? {};
}

export async function addReviewLog({ issueKey, reviewer, timeSpent, bundle, postToJira = true }) {
  const key = normalizeIssueKey(issueKey);
  const reviewerName = normalizeReviewer(reviewer);
  const duration = normalizeTimeSpent(timeSpent);
  if (!key || !reviewerName || !duration) {
    throw new Error('issueKey, reviewer and time_spent are required.');
  }
  assertTicketExists(bundle, key);

  const comment = formatReviewComment(reviewerName, duration);
  if (postToJira) {
    await postJiraComment(key, comment);
  }

  const store = await readReviewLogStore();
  const entry = {
    id: createReviewLogId(),
    reviewer: reviewerName,
    time_spent: duration,
    comment,
    created_at: new Date().toISOString(),
    updated_at: null,
  };
  const existing = listLogsForIssue(store, key);
  store.logs_by_issue[key] = existing.concat(entry);
  await writeReviewLogStore(store);
  return { issueKey: key, log: entry, logs: store.logs_by_issue[key], comment };
}

export async function updateReviewLog({ issueKey, logId, reviewer, timeSpent, bundle, postToJira = true }) {
  const key = normalizeIssueKey(issueKey);
  const id = String(logId ?? '').trim();
  const reviewerName = normalizeReviewer(reviewer);
  const duration = normalizeTimeSpent(timeSpent);
  if (!key || !id || !reviewerName || !duration) {
    throw new Error('issueKey, id, reviewer and time_spent are required.');
  }
  assertTicketExists(bundle, key);

  const store = await readReviewLogStore();
  const logs = listLogsForIssue(store, key);
  const index = logs.findIndex((log) => log.id === id);
  if (index < 0) {
    throw new Error(`Review log ${id} was not found on ${key}.`);
  }

  const previous = logs[index];
  const comment = formatReviewComment(reviewerName, duration);
  const editNote = previous.comment === comment
    ? comment
    : `Updated code review log: ${comment} (was: ${previous.comment})`;
  if (postToJira) {
    await postJiraComment(key, editNote);
  }

  const updated = {
    ...previous,
    reviewer: reviewerName,
    time_spent: duration,
    comment,
    updated_at: new Date().toISOString(),
  };
  logs[index] = updated;
  store.logs_by_issue[key] = logs;
  await writeReviewLogStore(store);
  return { issueKey: key, log: updated, logs, comment: editNote };
}

export async function deleteReviewLog({ issueKey, logId, bundle }) {
  const key = normalizeIssueKey(issueKey);
  const id = String(logId ?? '').trim();
  if (!key || !id) {
    throw new Error('issueKey and id are required.');
  }
  assertTicketExists(bundle, key);

  const store = await readReviewLogStore();
  const logs = listLogsForIssue(store, key);
  const index = logs.findIndex((log) => log.id === id);
  if (index < 0) {
    throw new Error(`Review log ${id} was not found on ${key}.`);
  }
  const [removed] = logs.splice(index, 1);
  if (logs.length === 0) {
    delete store.logs_by_issue[key];
  } else {
    store.logs_by_issue[key] = logs;
  }
  await writeReviewLogStore(store);
  return { issueKey: key, log: removed, logs: store.logs_by_issue[key] ?? [] };
}
