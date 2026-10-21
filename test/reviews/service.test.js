import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Redirect the durable local store to a throwaway file and force the local (non-Blob) path.
process.env.REVIEW_LOGS_FILE = path.join(os.tmpdir(), `review-logs-test-${process.pid}-${Date.now()}.json`);
process.env.BLOB_READ_WRITE_TOKEN = '';
process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
process.env.JIRA_EMAIL = 'test@example.com';
process.env.JIRA_API_TOKEN = 'test-token';
process.env.JIRA_PROJECT_KEY = 'XQ';
process.env.JIRA_STORY_POINTS_FIELD = 'customfield_10010';
process.env.GITHUB_REPOS = '';

import {
  addReviewLog,
  updateReviewLog,
  deleteReviewLog,
  getReviewLogsMap,
  formatReviewComment,
} from '../../src/reviews/service.js';

function makeBundle() {
  return {
    tickets: {
      'ACME-1': { key: 'ACME-1' },
      'ACME-2': { key: 'ACME-2' },
      'ACME-3': { key: 'ACME-3' },
    },
  };
}

function installFetchStub() {
  const calls = [];
  const stub = mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 201,
      async text() {
        return '{}';
      },
    };
  });
  return { stub, calls };
}

test.after(() => {
  fs.rmSync(process.env.REVIEW_LOGS_FILE, { force: true });
});

test('formatReviewComment builds the Jira comment copy', () => {
  assert.equal(formatReviewComment('Alice', '2h'), 'Alice spent 2h on code review');
});

test('addReviewLog posts a Jira comment and persists the log', async () => {
  const { stub, calls } = installFetchStub();
  try {
    const result = await addReviewLog({ issueKey: 'ACME-1', reviewer: 'Alice', timeSpent: '2h', bundle: makeBundle() });
    assert.equal(result.log.reviewer, 'Alice');
    assert.equal(result.log.time_spent, '2h');
    assert.equal(result.log.comment, 'Alice spent 2h on code review');
    assert.equal(result.logs.length, 1);

    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes('/rest/api/3/issue/ACME-1/comment'));
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.body.content[0].content[0].text, 'Alice spent 2h on code review');

    const map = await getReviewLogsMap();
    assert.equal(map['ACME-1'].length, 1);
    assert.equal(map['ACME-1'][0].id, result.log.id);
  } finally {
    stub.mock.restore();
  }
});

test('updateReviewLog edits the log and posts an update comment', async () => {
  const { stub, calls } = installFetchStub();
  try {
    const added = await addReviewLog({ issueKey: 'ACME-3', reviewer: 'Alice', timeSpent: '2h', bundle: makeBundle() });
    calls.length = 0;

    const updated = await updateReviewLog({
      issueKey: 'ACME-3',
      logId: added.log.id,
      reviewer: 'Alice',
      timeSpent: '3h',
      bundle: makeBundle(),
    });
    assert.equal(updated.log.time_spent, '3h');
    assert.equal(updated.log.comment, 'Alice spent 3h on code review');
    assert.ok(updated.log.updated_at);

    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].options.body);
    assert.ok(body.body.content[0].content[0].text.includes('Updated code review log'));
    assert.equal(updated.logs.length, 1);
  } finally {
    stub.mock.restore();
  }
});

test('deleteReviewLog removes the log and drops the issue bucket when empty', async () => {
  const { stub } = installFetchStub();
  try {
    const added = await addReviewLog({ issueKey: 'ACME-2', reviewer: 'Bob', timeSpent: '1.5h', bundle: makeBundle() });
    const removed = await deleteReviewLog({ issueKey: 'ACME-2', logId: added.log.id, bundle: makeBundle() });
    assert.equal(removed.log.id, added.log.id);
    assert.deepEqual(removed.logs, []);

    const map = await getReviewLogsMap();
    assert.equal(map['ACME-2'], undefined);
  } finally {
    stub.mock.restore();
  }
});
