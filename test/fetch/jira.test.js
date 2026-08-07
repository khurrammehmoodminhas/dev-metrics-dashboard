import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJiraFieldUpdatePayload } from '../../src/fetch/jira.js';

test('buildJiraFieldUpdatePayload wraps plain text fields for Jira', () => {
  assert.deepStrictEqual(buildJiraFieldUpdatePayload('summary', 'Ship it'), {
    fields: { summary: 'Ship it' },
  });
});

test('buildJiraFieldUpdatePayload maps assignee values to Jira accountId shape', () => {
  assert.deepStrictEqual(buildJiraFieldUpdatePayload('assignee', 'user-123'), {
    fields: { assignee: { accountId: 'user-123' } },
  });
});
