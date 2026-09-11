import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJiraFieldUpdatePayload, buildJiraCommentAdf } from '../../src/fetch/jira.js';

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

test('buildJiraCommentAdf wraps plain text in Atlassian Document Format', () => {
  assert.deepStrictEqual(buildJiraCommentAdf('Alice spent 2h on code review'), {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Alice spent 2h on code review' }],
      },
    ],
  });
});

test('buildJiraCommentAdf trims whitespace from the comment text', () => {
  const adf = buildJiraCommentAdf('  Bob spent 45m on code review  ');
  assert.equal(adf.content[0].content[0].text, 'Bob spent 45m on code review');
});

