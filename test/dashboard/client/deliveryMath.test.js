import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterTicketsBySelectedReleases,
  computeReleasePointComparison,
  computeReleaseSummary,
  computeDeveloperDelivery,
  computeTicketStatusBreakdown,
  computeIssueTypeBreakdown,
} from '../../../src/dashboard/client/deliveryMathNode.js';

function ticket(overrides) {
  return {
    key: 'XQ-0000',
    status_category: 'done',
    sp: 2,
    ap: 2,
    ai_contribution_percent: 50,
    assignee_account_id: 'dev-a',
    assignee_display_name: 'Dev A',
    fix_versions: [{ id: '1', name: '8.6.0', released: false, release_date: null }],
    ...overrides,
  };
}

test('filterTicketsBySelectedReleases matches tickets whose fix_versions intersects the selection', () => {
  const ticketsByKey = {
    'XQ-1': ticket({ key: 'XQ-1', fix_versions: [{ name: '8.5.0' }] }),
    'XQ-2': ticket({ key: 'XQ-2', fix_versions: [{ name: '8.6.0' }] }),
    'XQ-3': ticket({ key: 'XQ-3', fix_versions: [{ name: '7.0.0' }] }),
  };
  const visible = filterTicketsBySelectedReleases(ticketsByKey, ['8.5.0', '8.6.0']);
  assert.deepEqual(
    visible.map((t) => t.key).sort(),
    ['XQ-1', 'XQ-2'],
  );
});

test('filterTicketsBySelectedReleases counts a multi-release ticket only once when both its releases are selected', () => {
  const ticketsByKey = {
    'XQ-1': ticket({ key: 'XQ-1', fix_versions: [{ name: '8.5.0' }, { name: '8.6.0' }] }),
  };
  const visible = filterTicketsBySelectedReleases(ticketsByKey, ['8.5.0', '8.6.0']);
  assert.equal(visible.length, 1);
});

test('computeReleaseSummary totals SP/AP and counts completed vs remaining via status_category', () => {
  const tickets = [
    ticket({ status_category: 'done', sp: 3, ap: 3 }),
    ticket({ status_category: 'indeterminate', sp: 5, ap: null }),
    ticket({ status_category: 'new', sp: 2, ap: null }),
  ];
  const summary = computeReleaseSummary(tickets);
  assert.equal(summary.total_tickets, 3);
  assert.equal(summary.completed_tickets, 1);
  assert.equal(summary.remaining_tickets, 2);
  assert.equal(summary.total_planned_sp, 10);
  assert.equal(summary.total_delivered_ap, 3);
});

test('computeReleaseSummary averages AI contribution only over tickets with a recorded value, with a coverage count', () => {
  const tickets = [
    ticket({ ai_contribution_percent: 80 }),
    ticket({ ai_contribution_percent: 60 }),
    ticket({ ai_contribution_percent: null }),
  ];
  const summary = computeReleaseSummary(tickets);
  assert.equal(summary.team_ai_contribution_percent, 70);
  assert.equal(summary.team_ai_contribution_coverage, 2);
});

test('computeReleasePointComparison totals each release and can filter to one developer', () => {
  const tickets = [
    ticket({ key: 'XQ-1', assignee_account_id: 'dev-a', sp: 3, ap: 2, fix_versions: [{ name: '8.5.0' }] }),
    ticket({ key: 'XQ-2', assignee_account_id: 'dev-b', sp: 5, ap: 4, fix_versions: [{ name: '8.5.0' }, { name: '8.6.0' }] }),
  ];
  const all = computeReleasePointComparison(tickets, ['8.5.0', '8.6.0']);
  assert.deepEqual(all, [
    { release_name: '8.5.0', planned_sp: 8, delivered_ap: 6, ticket_count: 2 },
    { release_name: '8.6.0', planned_sp: 5, delivered_ap: 4, ticket_count: 1 },
  ]);
  assert.deepEqual(computeReleasePointComparison(tickets, ['8.5.0', '8.6.0'], 'dev-a'), [
    { release_name: '8.5.0', planned_sp: 3, delivered_ap: 2, ticket_count: 1 },
    { release_name: '8.6.0', planned_sp: 0, delivered_ap: 0, ticket_count: 0 },
  ]);
});

test('computeDeveloperDelivery groups by assignee and sums SP/AP per developer', () => {
  const tickets = [
    ticket({ assignee_account_id: 'dev-a', assignee_display_name: 'Dev A', sp: 3, ap: 3 }),
    ticket({ assignee_account_id: 'dev-a', assignee_display_name: 'Dev A', sp: 2, ap: 1 }),
    ticket({ assignee_account_id: 'dev-b', assignee_display_name: 'Dev B', sp: 5, ap: 4 }),
  ];
  const rows = computeDeveloperDelivery(tickets);
  const devA = rows.find((r) => r.assignee_account_id === 'dev-a');
  const devB = rows.find((r) => r.assignee_account_id === 'dev-b');
  assert.equal(devA.ticket_count, 2);
  assert.equal(devA.planned_sp, 5);
  assert.equal(devA.delivered_ap, 4);
  assert.equal(devB.delivered_ap, 4);
});

test('computeDeveloperDelivery computes % of highest AP and % of team AP relative to the current selection', () => {
  const tickets = [
    ticket({ assignee_account_id: 'dev-a', ap: 40 }),
    ticket({ assignee_account_id: 'dev-b', ap: 20 }),
  ];
  const rows = computeDeveloperDelivery(tickets);
  const devA = rows.find((r) => r.assignee_account_id === 'dev-a');
  const devB = rows.find((r) => r.assignee_account_id === 'dev-b');
  assert.equal(devA.percent_of_highest_ap, 100);
  assert.equal(devB.percent_of_highest_ap, 50);
  assert.equal(devA.percent_of_team_ap, (40 / 60) * 100);
  assert.equal(devB.percent_of_team_ap, (20 / 60) * 100);
});

test('computeDeveloperDelivery shows null percentages instead of dividing by zero when nobody has delivered AP yet', () => {
  const tickets = [ticket({ assignee_account_id: 'dev-a', ap: null })];
  const rows = computeDeveloperDelivery(tickets);
  assert.equal(rows[0].percent_of_highest_ap, null);
  assert.equal(rows[0].percent_of_team_ap, null);
});

test('computeDeveloperDelivery groups unassigned tickets under a stable "unassigned" key without throwing', () => {
  const tickets = [ticket({ assignee_account_id: null, assignee_display_name: null })];
  const rows = computeDeveloperDelivery(tickets);
  assert.equal(rows[0].assignee_account_id, 'unassigned');
  assert.equal(rows[0].assignee_display_name, 'Unassigned');
});

test('computeTicketStatusBreakdown counts and percentages by status category', () => {
  const tickets = [
    ticket({ status_category: 'done' }),
    ticket({ status_category: 'done' }),
    ticket({ status_category: 'indeterminate' }),
    ticket({ status_category: 'new' }),
  ];
  const breakdown = computeTicketStatusBreakdown(tickets);
  const done = breakdown.find((b) => b.status_category === 'done');
  const inProgress = breakdown.find((b) => b.status_category === 'indeterminate');
  const toDo = breakdown.find((b) => b.status_category === 'new');
  assert.equal(done.count, 2);
  assert.equal(done.percent, 50);
  assert.equal(done.label, 'Done');
  assert.equal(inProgress.count, 1);
  assert.equal(toDo.count, 1);
});

test('computeTicketStatusBreakdown handles an empty ticket list without dividing by zero', () => {
  const breakdown = computeTicketStatusBreakdown([]);
  assert.ok(breakdown.every((b) => b.count === 0 && b.percent === null));
});

test('computeIssueTypeBreakdown facets ticket count, SP, and AP by issue type', () => {
  const tickets = [
    ticket({ issue_type: 'Bug', sp: 1, ap: 1 }),
    ticket({ issue_type: 'Bug', sp: 2, ap: 1 }),
    ticket({ issue_type: 'Story', sp: 5, ap: 3 }),
  ];
  const breakdown = computeIssueTypeBreakdown(tickets);
  const bugs = breakdown.find((b) => b.issue_type === 'Bug');
  const stories = breakdown.find((b) => b.issue_type === 'Story');
  assert.equal(bugs.ticket_count, 2);
  assert.equal(bugs.planned_sp, 3);
  assert.equal(bugs.delivered_ap, 2);
  assert.equal(stories.ticket_count, 1);
});

test('computeIssueTypeBreakdown labels a missing issue type as Unspecified instead of throwing', () => {
  const tickets = [ticket({ issue_type: null })];
  const breakdown = computeIssueTypeBreakdown(tickets);
  assert.equal(breakdown[0].issue_type, 'Unspecified');
});
