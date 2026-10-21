import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, readJsonBody } from '../../src/http/body.js';

const jsonHeaders = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };

test('readJsonBody accepts a same-origin JSON body', async () => {
  assert.deepEqual(await readJsonBody({ headers: jsonHeaders, body: '{"a":1}' }), { a: 1 });
});

test('readJsonBody accepts JSON from non-browser clients without Sec-Fetch-Site', async () => {
  assert.deepEqual(
    await readJsonBody({ headers: { 'content-type': 'application/json; charset=utf-8' }, body: { a: 1 } }),
    { a: 1 },
  );
});

test('readJsonBody rejects a text/plain body (cross-site form CSRF)', async () => {
  await assert.rejects(
    readJsonBody({ headers: { 'content-type': 'text/plain' }, body: '{"updates":{"summary":"x"}}' }),
    (error) => error instanceof HttpError && error.status === 415,
  );
});

test('readJsonBody rejects requests the browser marks as cross-site', async () => {
  await assert.rejects(
    readJsonBody({ headers: { ...jsonHeaders, 'sec-fetch-site': 'cross-site' }, body: '{}' }),
    (error) => error instanceof HttpError && error.status === 403,
  );
});

test('readJsonBody reports malformed JSON as a 400', async () => {
  await assert.rejects(
    readJsonBody({ headers: jsonHeaders, body: '{nope' }),
    (error) => error instanceof HttpError && error.status === 400,
  );
});
