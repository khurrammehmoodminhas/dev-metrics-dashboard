import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTicketPrIndex } from '../../src/merge/ticketPrIndex.js';

function fakePr(overrides) {
  return {
    repo: 'bvs-xiangqi/xiangqi-client',
    number: 4001,
    title: 'XQ-5003: Implement Neon theme',
    state: 'merged',
    created_at: '2026-07-01T00:00:00Z',
    merged_at: '2026-07-03T00:00:00Z',
    linked_ticket_id: 'XQ-5003',
    ai_contribution: { checklist_score_percent: 85, commit_ai_percent: 90 },
    assignee_login: null,
    reviewers: [],
    time_to_first_review_hours: null,
    time_to_approval_hours: null,
    review_completion_time_hours: null,
    ...overrides,
  };
}

test('groups a single PR under its linked ticket key', () => {
  const index = buildTicketPrIndex([fakePr({})]);
  assert.equal(index.size, 1);
  const evidence = index.get('XQ-5003');
  assert.equal(evidence.length, 1);
  assert.deepEqual(evidence[0], {
    repo: 'bvs-xiangqi/xiangqi-client',
    pr_number: 4001,
    pr_url: 'https://github.com/bvs-xiangqi/xiangqi-client/pull/4001',
    pr_title: 'XQ-5003: Implement Neon theme',
    pr_state: 'merged',
    pr_created_at: '2026-07-01T00:00:00Z',
    pr_merged_at: '2026-07-03T00:00:00Z',
    pr_ai_checklist_percent: 85,
    pr_commit_co_author_percent: 90,
    pr_assignee_login: null,
    pr_reviewers: [],
    pr_time_to_first_review_hours: null,
    pr_time_to_approval_hours: null,
    pr_review_completion_time_hours: null,
  });
});

test('keeps pr_created_at/pr_merged_at null-safe when missing', () => {
  const index = buildTicketPrIndex([fakePr({ created_at: undefined, merged_at: undefined })]);
  const evidence = index.get('XQ-5003')[0];
  assert.equal(evidence.pr_created_at, null);
  assert.equal(evidence.pr_merged_at, null);
});

test('groups multiple PRs across repos under the same ticket key', () => {
  const index = buildTicketPrIndex([
    fakePr({ repo: 'bvs-xiangqi/xiangqi-client', number: 4001 }),
    fakePr({ repo: 'bvs-xiangqi/xiangqi-server', number: 1920 }),
  ]);
  const evidence = index.get('XQ-5003');
  assert.equal(evidence.length, 2);
  assert.deepEqual(
    evidence.map((e) => e.repo),
    ['bvs-xiangqi/xiangqi-client', 'bvs-xiangqi/xiangqi-server'],
  );
});

test('skips PRs with no linked ticket id', () => {
  const index = buildTicketPrIndex([fakePr({ linked_ticket_id: null })]);
  assert.equal(index.size, 0);
});

test('handles missing ai_contribution data without throwing', () => {
  const index = buildTicketPrIndex([fakePr({ ai_contribution: undefined })]);
  const evidence = index.get('XQ-5003')[0];
  assert.equal(evidence.pr_ai_checklist_percent, null);
  assert.equal(evidence.pr_commit_co_author_percent, null);
});

test('returns an empty map for an empty input list', () => {
  const index = buildTicketPrIndex([]);
  assert.equal(index.size, 0);
});
