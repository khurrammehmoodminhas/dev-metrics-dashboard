import test from 'node:test';
import assert from 'node:assert/strict';
import { sendRefreshStream } from '../../src/http/refreshStream.js';

function createResponse() {
  return {
    headers: null,
    chunks: [],
    ended: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    write(chunk) {
      this.chunks.push(chunk);
    },
    end() {
      this.ended = true;
    },
  };
}

test('sendRefreshStream streams refresh progress and a final result', async () => {
  const res = createResponse();
  await sendRefreshStream(res, async (onProgress) => {
    onProgress('Fetching Jira releases…');
    onProgress('Fetching Jira tickets…');
    return { generated_at: 'now', warnings: [] };
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'application/x-ndjson; charset=utf-8');
  assert.equal(res.ended, true);
  assert.deepEqual(
    res.chunks.map((chunk) => JSON.parse(chunk)),
    [
      { type: 'progress', message: 'Fetching Jira releases…' },
      { type: 'progress', message: 'Fetching Jira tickets…' },
      { type: 'result', ok: true, generatedAt: 'now', warnings: [] },
    ],
  );
});

test('sendRefreshStream sends refresh errors as a final result event', async () => {
  const res = createResponse();
  await sendRefreshStream(res, async () => {
    throw new Error('Jira is unavailable.');
  });

  assert.deepEqual(JSON.parse(res.chunks.at(-1)), {
    type: 'result',
    ok: false,
    error: 'Jira is unavailable.',
  });
  assert.equal(res.ended, true);
});
