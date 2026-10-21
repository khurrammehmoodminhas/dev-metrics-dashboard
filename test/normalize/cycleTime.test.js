import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCycleTimeFromChangelog as derive } from '../../src/normalize/cycleTime.js';

const STATUSES = { inProgressStatuses: ['In Progress'], codeReviewStatuses: ['Code Review'] };
const deriveCycleTimeFromChangelog = (values) => derive(values, STATUSES);

function statusEntry(created, fromString, toString) {
  return { created, items: [{ field: 'status', fromString, toString }] };
}

// Shaped like a real Jira Cloud changelog, including Code Review <-> Internal QA
// cycling.
const REALISTIC_CHANGELOG = [
  statusEntry('2026-07-01T11:19:59.647+0500', 'Todo', 'Selected for Development'),
  statusEntry('2026-07-05T21:02:13.787+0500', 'Selected for Development', 'In Progress'),
  statusEntry('2026-07-07T12:12:43.923+0500', 'In Progress', 'Code Review'),
  statusEntry('2026-07-07T12:12:46.001+0500', 'Code Review', 'Code Review'),
  statusEntry('2026-07-13T13:41:38.368+0500', 'Code Review', 'Internal QA'),
  statusEntry('2026-07-13T13:41:40.728+0500', 'Internal QA', 'Code Review'),
  statusEntry('2026-07-13T13:42:37.393+0500', 'Code Review', 'Internal QA'),
  statusEntry('2026-07-13T20:03:46.523+0500', 'Internal QA', "Davd's QA Staging"),
  statusEntry('2026-07-15T13:50:35.988+0500', "Davd's QA Staging", 'Verified on Staging'),
  statusEntry('2026-07-17T18:34:52.084+0500', 'Verified on Staging', 'Done'),
];

test('derives the first In Progress -> first Code Review transition from a real changelog', () => {
  const result = deriveCycleTimeFromChangelog(REALISTIC_CHANGELOG);
  assert.equal(result.first_in_progress_at, new Date('2026-07-05T21:02:13.787+0500').toISOString());
  assert.equal(result.first_code_review_at_after_in_progress, new Date('2026-07-07T12:12:43.923+0500').toISOString());
  // ~1 day, 15h11m ≈ 39.18 hours
  assert.ok(Math.abs(result.in_progress_to_code_review_hours - 39.18) < 0.1);
});

test('ignores later re-entries into Code Review after Internal QA cycling', () => {
  const result = deriveCycleTimeFromChangelog(REALISTIC_CHANGELOG);
  // The second and third "-> Code Review" transitions (after Internal QA) must
  // NOT be used — the derived timestamp must match the FIRST one only.
  assert.notEqual(
    result.first_code_review_at_after_in_progress,
    new Date('2026-07-13T13:41:40.728+0500').toISOString(),
  );
});

test('returns all nulls when the ticket never reached In Progress', () => {
  const changelog = [statusEntry('2026-07-01T00:00:00Z', 'Todo', 'Selected for Development')];
  const result = deriveCycleTimeFromChangelog(changelog);
  assert.equal(result.first_in_progress_at, null);
  assert.equal(result.first_code_review_at_after_in_progress, null);
  assert.equal(result.in_progress_to_code_review_hours, null);
});

test('returns a null Code Review timestamp (not an estimate) when the ticket reached In Progress but not Code Review yet', () => {
  const changelog = [statusEntry('2026-07-01T00:00:00Z', 'Selected for Development', 'In Progress')];
  const result = deriveCycleTimeFromChangelog(changelog);
  assert.ok(result.first_in_progress_at);
  assert.equal(result.first_code_review_at_after_in_progress, null);
  assert.equal(result.in_progress_to_code_review_hours, null);
});

test('does not use a Code Review transition that happened before the first In Progress transition', () => {
  // Pathological/out-of-order input: a stray "-> Code Review" entry timestamped
  // before the ticket ever entered "In Progress" must not be picked up.
  const changelog = [
    statusEntry('2026-06-01T00:00:00Z', 'Backlog', 'Code Review'),
    statusEntry('2026-07-01T00:00:00Z', 'Selected for Development', 'In Progress'),
  ];
  const result = deriveCycleTimeFromChangelog(changelog);
  assert.equal(result.first_code_review_at_after_in_progress, null);
});

test('handles an empty or missing changelog without throwing', () => {
  assert.deepEqual(deriveCycleTimeFromChangelog([]), {
    first_in_progress_at: null,
    first_code_review_at_after_in_progress: null,
    in_progress_to_code_review_hours: null,
  });
  assert.deepEqual(deriveCycleTimeFromChangelog(undefined), {
    first_in_progress_at: null,
    first_code_review_at_after_in_progress: null,
    in_progress_to_code_review_hours: null,
  });
});

test('ignores changelog entries unrelated to status (e.g. Fix Version changes)', () => {
  const changelog = [
    { created: '2026-07-01T00:00:00Z', items: [{ field: 'Fix Version', fromString: null, toString: '8.5.0' }] },
    statusEntry('2026-07-02T00:00:00Z', 'Selected for Development', 'In Progress'),
  ];
  const result = deriveCycleTimeFromChangelog(changelog);
  assert.ok(result.first_in_progress_at);
});

test('status mapping is configurable and case-insensitive', () => {
  const changelog = [
    {
      created: '2026-07-01T09:00:00.000+0000',
      items: [{ field: 'status', fromString: 'To Do', toString: 'development' }],
    },
    {
      created: '2026-07-02T09:00:00.000+0000',
      items: [{ field: 'status', fromString: 'development', toString: 'IN REVIEW' }],
    },
  ];
  const result = derive(changelog, {
    inProgressStatuses: ['Development', 'In Progress'],
    codeReviewStatuses: ['In Review'],
  });
  assert.equal(result.in_progress_to_code_review_hours, 24);
});
