import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { useTestEnv, mockFetch } from '../helpers/config.js';

process.env.REVIEW_LOGS_FILE = path.join(os.tmpdir(), `review-logs-handlers-${process.pid}-${Date.now()}.json`);
const restoreEnv = useTestEnv({ BLOB_READ_WRITE_TOKEN: '' });
const { handleTicketUpdate, handleReviews, handleAssistant, handleRefresh, errorPage } =
  await import('../../src/http/handlers.js');
const { resetConfigCache } = await import('../../src/config/index.js');

const originalWarn = console.warn;
test.before(() => {
  console.warn = () => {};
});
test.after(() => {
  console.warn = originalWarn;
  restoreEnv();
});

const bundle = { generated_at: 'now', tickets: { 'ACME-1': { key: 'ACME-1', sp: 3 } } };
const refresh = async () => bundle;

test('handleTicketUpdate rejects bad keys, empty and unknown fields before touching Jira', async () => {
  const restore = mockFetch([]);
  try {
    assert.equal((await handleTicketUpdate({ issueKey: 'nope', body: { sp: 1 }, refresh })).status, 400);
    assert.equal((await handleTicketUpdate({ issueKey: 'ACME-1', body: {}, refresh })).status, 400);
    const otherProject = await handleTicketUpdate({ issueKey: 'OTHER-1', body: { updates: { sp: 1 } }, refresh });
    assert.equal(otherProject.status, 403);
    const unknown = await handleTicketUpdate({ issueKey: 'ACME-1', body: { updates: { description: 'x' } }, refresh });
    assert.equal(unknown.status, 400);
    assert.match(unknown.json.error, /description/);
    assert.equal(restore.calls.length, 0);
  } finally {
    restore();
  }
});

test('handleTicketUpdate applies fields serially and reports partial failure', async () => {
  const restore = mockFetch([
    [
      /\/issue\/ACME-1$/,
      (url, init) =>
        JSON.parse(init.body).fields.customfield_10833 !== undefined
          ? { status: 400, json: { errorMessages: ['AP locked'] } }
          : { status: 204 },
    ],
  ]);
  try {
    const ok = await handleTicketUpdate({ issueKey: 'acme-1', body: { updates: { sp: 5 } }, refresh });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.updatedFields, [{ field: 'sp', value: 5 }]);
    assert.equal(ok.json.ticket.key, 'ACME-1');

    const partial = await handleTicketUpdate({ issueKey: 'ACME-1', body: { updates: { sp: 5, ap: 2 } }, refresh });
    assert.equal(partial.status, 502);
    assert.deepEqual(partial.json.appliedFields, [{ field: 'sp', value: 5 }]);
    assert.equal(partial.json.failedField, 'ap');
    assert.match(partial.json.error, /AP locked/);
  } finally {
    restore();
  }
});

test('handleTicketUpdate still reports success when the post-write refresh fails', async () => {
  const restore = mockFetch([[/\/issue\/ACME-1$/, { status: 204 }]]);
  try {
    const result = await handleTicketUpdate({
      issueKey: 'ACME-1',
      body: { sp: 1 },
      refresh: async () => {
        throw new Error('blob down');
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.json.ticket, null);
  } finally {
    restore();
  }
});

test('handleTicketUpdate is a 403 when editing is disabled', async () => {
  const restoreDisabled = useTestEnv({ JIRA_EDITING_ENABLED: 'false', BLOB_READ_WRITE_TOKEN: '' });
  try {
    const result = await handleTicketUpdate({ issueKey: 'ACME-1', body: { sp: 1 }, refresh });
    assert.equal(result.status, 403);
  } finally {
    restoreDisabled();
    useTestEnv({ BLOB_READ_WRITE_TOKEN: '' });
    resetConfigCache();
  }
});

test('handleReviews validates input and posts the Jira comment on add', async () => {
  const restore = mockFetch([[/\/comment$/, { status: 201, json: {} }]]);
  try {
    const missing = await handleReviews({
      method: 'POST',
      body: { action: 'add', issueKey: 'ACME-1' },
      getBundle: async () => bundle,
    });
    assert.equal(missing.status, 400);
    const unknownTicket = await handleReviews({
      method: 'POST',
      body: { issueKey: 'ACME-9', reviewer: 'A', time_spent: '1h' },
      getBundle: async () => bundle,
    });
    assert.equal(unknownTicket.status, 400);
    assert.equal(restore.calls.length, 0);

    const added = await handleReviews({
      method: 'POST',
      body: { issueKey: 'ACME-1', reviewer: 'Alice', time_spent: '2h' },
      getBundle: async () => bundle,
    });
    assert.equal(added.status, 200);
    assert.equal(added.json.log.comment, 'Alice spent 2h on code review');
    assert.equal(restore.calls.length, 1);

    const listed = await handleReviews({ method: 'GET', body: {}, getBundle: async () => bundle });
    assert.equal(listed.json.review_logs['ACME-1'].length, 1);
    assert.equal((await handleReviews({ method: 'DELETE', body: {}, getBundle: async () => bundle })).status, 405);
  } finally {
    restore();
  }
});

test('handleAssistant is a 403 when no AI_API_KEY is configured', async () => {
  const result = await handleAssistant({ body: { messages: [] }, getBundle: async () => bundle, refresh });
  assert.equal(result.status, 403);
});

test('handleRefresh reports timeouts and failures as JSON errors', async () => {
  const slow = () => new Promise(() => {});
  const timedOut = await handleRefresh({ refresh: slow, timeoutMs: 20 });
  assert.equal(timedOut.status, 500);
  assert.match(timedOut.json.error, /timed out/);

  const failed = await handleRefresh({
    refresh: async () => {
      throw new Error('Jira API 401 fetching');
    },
  });
  assert.equal(failed.status, 500);
  const ok = await handleRefresh({ refresh });
  assert.deepEqual(ok, { status: 200, json: { ok: true, generatedAt: 'now', warnings: [] } });
});

test('errorPage escapes the message', () => {
  assert.ok(errorPage(new Error('<script>')).includes('&lt;script&gt;'));
});
