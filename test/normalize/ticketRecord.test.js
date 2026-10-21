import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJiraIssue } from '../../src/normalize/ticketRecord.js';
import { testConfig } from '../helpers/config.js';

const CONFIG = testConfig({ JIRA_BASE_URL: 'https://acme.atlassian.net', JIRA_PROJECT_KEY: 'ACME' });

// Field shapes below are modeled on real Jira Cloud tickets, including the
// customfield IDs from the test config and an AI Contribution field stored as
// a 0-1 fraction (JIRA_AI_CONTRIBUTION_SCALE=fraction).
const DONE_TICKET = {
  key: 'ACME-4821',
  fields: {
    summary: 'Filter inactive accounts from the weekly report',
    issuetype: { name: 'Task' },
    status: { name: 'Done', statusCategory: { key: 'done' } },
    assignee: { displayName: 'Dev One', accountId: 'acct-dev-one' },
    customfield_10010: 2,
    customfield_10833: 3,
    customfield_11729: 0.87,
    fixVersions: [{ id: '16212', name: '8.5.0', released: true, releaseDate: '2026-07-16' }],
    created: '2026-06-30T10:00:00.000+0500',
    resolutiondate: '2026-07-15T10:00:00.000+0500',
  },
};

const IN_PROGRESS_TICKET_NO_AP_YET = {
  key: 'ACME-5065',
  fields: {
    summary: 'Connect the billing page to the quota API',
    issuetype: { name: 'Task' },
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    assignee: { displayName: 'Dev Two', accountId: 'acct-dev-two' },
    customfield_10010: 5,
    customfield_10833: null,
    customfield_11729: 0,
    fixVersions: [{ id: '16312', name: '8.5.1 (Billing)', released: false, releaseDate: null }],
    resolutiondate: null,
  },
};

test('normalizeJiraIssue converts the AI Contribution fraction to a 0-100 percent', () => {
  const record = normalizeJiraIssue(DONE_TICKET, new Map(), new Map(), CONFIG);
  assert.equal(record.ai_contribution_percent, 87);
});

test('normalizeJiraIssue extracts SP/AP correctly and derives status_category from statusCategory.key', () => {
  const record = normalizeJiraIssue(DONE_TICKET, new Map(), new Map(), CONFIG);
  assert.equal(record.sp, 2);
  assert.equal(record.ap, 3);
  assert.equal(record.status, 'Done');
  assert.equal(record.status_category, 'done');
  assert.equal(record.assignee_display_name, 'Dev One');
});

test('normalizeJiraIssue keeps a null AP as null, never coerced to 0', () => {
  const record = normalizeJiraIssue(IN_PROGRESS_TICKET_NO_AP_YET, new Map(), new Map(), CONFIG);
  assert.equal(record.ap, null);
});

test('normalizeJiraIssue keeps a genuine 0% AI contribution as 0, not null', () => {
  const record = normalizeJiraIssue(IN_PROGRESS_TICKET_NO_AP_YET, new Map(), new Map(), CONFIG);
  assert.equal(record.ai_contribution_percent, 0);
});

test('normalizeJiraIssue treats a missing AI Contribution field as null, not 0', () => {
  const ticket = {
    key: 'ACME-9999',
    fields: { ...DONE_TICKET.fields, customfield_11729: null },
  };
  const record = normalizeJiraIssue(ticket, new Map(), new Map(), CONFIG);
  assert.equal(record.ai_contribution_percent, null);
});

test('normalizeJiraIssue handles an unassigned ticket without throwing', () => {
  const ticket = { key: 'ACME-1111', fields: { ...DONE_TICKET.fields, assignee: null } };
  const record = normalizeJiraIssue(ticket, new Map(), new Map(), CONFIG);
  assert.equal(record.assignee_display_name, null);
  assert.equal(record.assignee_account_id, null);
});

test('normalizeJiraIssue preserves multiple fix versions', () => {
  const ticket = {
    key: 'ACME-2222',
    fields: {
      ...DONE_TICKET.fields,
      fixVersions: [
        { id: '16212', name: '8.5.0', released: true, releaseDate: '2026-07-16' },
        { id: '16278', name: '8.6.0', released: false, releaseDate: null },
      ],
    },
  };
  const record = normalizeJiraIssue(ticket, new Map(), new Map(), CONFIG);
  assert.equal(record.fix_versions.length, 2);
  assert.deepEqual(
    record.fix_versions.map((v) => v.name),
    ['8.5.0', '8.6.0'],
  );
});

test('normalizeJiraIssue builds the Jira URL and defaults to an empty PR evidence list', () => {
  const record = normalizeJiraIssue(DONE_TICKET, new Map(), new Map(), CONFIG);
  assert.equal(record.jira_url, 'https://acme.atlassian.net/browse/ACME-4821');
  assert.deepEqual(record.linked_prs, []);
});

test('normalizeJiraIssue attaches PR evidence from the index when present', () => {
  const evidence = [{ repo: 'acme/web-client', pr_number: 4001, pr_state: 'merged' }];
  const prIndex = new Map([['ACME-4821', evidence]]);
  const record = normalizeJiraIssue(DONE_TICKET, prIndex, new Map(), CONFIG);
  assert.deepEqual(record.linked_prs, evidence);
});

test('normalizeJiraIssue extracts the created_at date', () => {
  const record = normalizeJiraIssue(DONE_TICKET, new Map(), new Map(), CONFIG);
  assert.equal(record.created_at, '2026-06-30T10:00:00.000+0500');
});

test('normalizeJiraIssue derives cycle-time fields from the changelog map when present', () => {
  const changelog = [
    { created: '2026-07-05T00:00:00Z', items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }] },
    {
      created: '2026-07-07T00:00:00Z',
      items: [{ field: 'status', fromString: 'In Progress', toString: 'Code Review' }],
    },
  ];
  const changelogByKey = new Map([['ACME-4821', changelog]]);
  const record = normalizeJiraIssue(DONE_TICKET, new Map(), changelogByKey, CONFIG);
  assert.equal(record.first_in_progress_at, new Date('2026-07-05T00:00:00Z').toISOString());
  assert.equal(record.first_code_review_at_after_in_progress, new Date('2026-07-07T00:00:00Z').toISOString());
  assert.equal(record.in_progress_to_code_review_hours, 48);
});

test('normalizeJiraIssue defaults cycle-time fields to null when no changelog is provided', () => {
  const record = normalizeJiraIssue(DONE_TICKET, new Map(), new Map(), CONFIG);
  assert.equal(record.first_in_progress_at, null);
  assert.equal(record.first_code_review_at_after_in_progress, null);
  assert.equal(record.in_progress_to_code_review_hours, null);
});

test('normalizeJiraIssue reads a percent-scale AI field without rescaling', () => {
  const percentConfig = testConfig({ JIRA_AI_CONTRIBUTION_SCALE: 'percent' });
  const ticket = { key: 'ACME-1', fields: { customfield_11729: 42 } };
  assert.equal(normalizeJiraIssue(ticket, new Map(), new Map(), percentConfig).ai_contribution_percent, 42);
});

test('normalizeJiraIssue leaves AP and AI null when those fields are not configured', () => {
  const minimal = testConfig({ JIRA_ACTUAL_POINTS_FIELD: '', JIRA_AI_CONTRIBUTION_FIELD: '' });
  const record = normalizeJiraIssue(DONE_TICKET, new Map(), new Map(), minimal);
  assert.equal(record.sp, 2);
  assert.equal(record.ap, null);
  assert.equal(record.ai_contribution_percent, null);
});
