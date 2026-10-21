import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketByDay,
  cumulativeSeries,
  computeMean,
  computeMedian,
  computeHistogramBuckets,
  buildReleaseProgressSeries,
  buildEngineeringActivityTrend,
  buildPrActivityTrend,
  buildDeveloperActivityTimeline,
  buildCycleTimeDistribution,
  chooseBucketPeriod,
  rollUpBuckets,
  resolveTrendWindow,
} from '../../../src/dashboard/client/timeSeriesNode.js';

function ticket(overrides) {
  return {
    key: 'ACME-0000',
    summary: 'A ticket',
    status_category: 'done',
    sp: 2,
    ap: 2,
    assignee_account_id: 'dev-a',
    created_at: '2026-07-01T00:00:00Z',
    resolved_at: '2026-07-03T00:00:00Z',
    first_in_progress_at: null,
    first_code_review_at_after_in_progress: null,
    in_progress_to_code_review_hours: null,
    linked_prs: [],
    ...overrides,
  };
}

function pr(overrides) {
  return {
    repo: 'acme/web-client',
    pr_number: 1,
    pr_state: 'merged',
    pr_created_at: '2026-07-01T00:00:00Z',
    pr_merged_at: '2026-07-02T00:00:00Z',
    ...overrides,
  };
}

// --- generic primitives ---

test('bucketByDay fills every day in the range, including zero-count days', () => {
  const buckets = bucketByDay(
    ['2026-07-01T00:00:00Z'],
    (d) => d,
    () => 1,
    '2026-07-01',
    '2026-07-03',
  );
  assert.deepEqual(buckets, [
    { date: '2026-07-01', value: 1 },
    { date: '2026-07-02', value: 0 },
    { date: '2026-07-03', value: 0 },
  ]);
});

test('bucketByDay sums a numeric value per day instead of just counting when given a value accessor', () => {
  const items = [
    { d: '2026-07-01T00:00:00Z', v: 3 },
    { d: '2026-07-01T12:00:00Z', v: 2 },
  ];
  const buckets = bucketByDay(
    items,
    (i) => i.d,
    (i) => i.v,
    '2026-07-01',
    '2026-07-01',
  );
  assert.equal(buckets[0].value, 5);
});

test('bucketByDay skips items with no date and items outside the range without throwing', () => {
  const items = [{ d: null }, { d: '2020-01-01T00:00:00Z' }];
  const buckets = bucketByDay(
    items,
    (i) => i.d,
    () => 1,
    '2026-07-01',
    '2026-07-01',
  );
  assert.equal(buckets[0].value, 0);
});

test('cumulativeSeries produces a running total', () => {
  const result = cumulativeSeries([
    { date: '2026-07-01', value: 2 },
    { date: '2026-07-02', value: 0 },
    { date: '2026-07-03', value: 3 },
  ]);
  assert.deepEqual(
    result.map((r) => r.value),
    [2, 2, 5],
  );
});

test('computeMean/computeMedian exclude non-numeric values and return null (not 0) when nothing remains', () => {
  assert.equal(computeMean([1, 2, null, 3]), 2);
  assert.equal(computeMean([null, undefined]), null);
  assert.equal(computeMedian([1, 3, 2]), 2);
  assert.equal(computeMedian([1, 2, 3, 4]), 2.5);
  assert.equal(computeMedian([]), null);
});

test('computeHistogramBuckets counts values into fixed ranges', () => {
  const ranges = [
    { label: 'low', min: 0, max: 10 },
    { label: 'high', min: 10, max: Infinity },
  ];
  const buckets = computeHistogramBuckets([5, 15, 8, 20], ranges);
  assert.equal(buckets.find((b) => b.label === 'low').count, 2);
  assert.equal(buckets.find((b) => b.label === 'high').count, 2);
});

// --- feature builders ---

test('buildReleaseProgressSeries totals planned SP and rises cumulative AP/completed toward it', () => {
  const tickets = [
    ticket({ created_at: '2026-07-01T00:00:00Z', resolved_at: '2026-07-01T00:00:00Z', sp: 3, ap: 3 }),
    ticket({ created_at: '2026-07-01T00:00:00Z', resolved_at: '2026-07-02T00:00:00Z', sp: 2, ap: 2 }),
  ];
  const series = buildReleaseProgressSeries(tickets, '2026-07-02T12:00:00Z');
  assert.equal(series.total_planned_sp, 5);
  const lastAp = series.cumulative_ap_by_day.at(-1);
  assert.equal(lastAp.value, 5);
  const lastCompleted = series.cumulative_tickets_completed_by_day.at(-1);
  assert.equal(lastCompleted.value, 2);
});

test('buildReleaseProgressSeries returns empty series without throwing when no ticket has any date', () => {
  const series = buildReleaseProgressSeries([ticket({ created_at: null, resolved_at: null })], '2026-07-02T00:00:00Z');
  assert.deepEqual(series.cumulative_ap_by_day, []);
});

test('buildReleaseProgressSeries starts at the first activity, not at an old backlog ticket', () => {
  const tickets = [
    ticket({ created_at: '2024-12-17T00:00:00Z', resolved_at: null, first_in_progress_at: null }),
    ticket({
      created_at: '2025-01-01T00:00:00Z',
      first_in_progress_at: '2026-06-28T00:00:00Z',
      resolved_at: '2026-07-01T00:00:00Z',
    }),
  ];
  const series = buildReleaseProgressSeries(tickets, '2026-07-02T00:00:00Z');
  assert.equal(series.cumulative_ap_by_day[0].date, '2026-06-28');
});

test('buildReleaseProgressSeries falls back to created_at when nothing has started yet', () => {
  const tickets = [ticket({ created_at: '2026-06-30T00:00:00Z', resolved_at: null })];
  const series = buildReleaseProgressSeries(tickets, '2026-07-02T00:00:00Z');
  assert.equal(series.cumulative_ap_by_day[0].date, '2026-06-30');
});

test('buildEngineeringActivityTrend tracks PR opened/merged, tickets moving to In Progress, and completions', () => {
  const tickets = [
    ticket({
      created_at: '2026-07-01T00:00:00Z',
      first_in_progress_at: '2026-07-02T00:00:00Z',
      resolved_at: '2026-07-03T00:00:00Z',
      linked_prs: [pr({ pr_created_at: '2026-07-01T00:00:00Z', pr_merged_at: '2026-07-03T00:00:00Z' })],
    }),
  ];
  const trend = buildEngineeringActivityTrend(tickets, '2026-07-03T12:00:00Z');
  assert.equal(trend.pr_opened_by_day.find((b) => b.date === '2026-07-01').value, 1);
  assert.equal(trend.tickets_in_progress_by_day.find((b) => b.date === '2026-07-02').value, 1);
  assert.equal(trend.pr_merged_by_day.find((b) => b.date === '2026-07-03').value, 1);
  assert.equal(trend.tickets_completed_by_day.find((b) => b.date === '2026-07-03').value, 1);
});

test('buildEngineeringActivityTrend dedupes a PR that somehow attaches to two tickets', () => {
  const sharedPr = pr({ repo: 'acme/web-client', pr_number: 99, pr_created_at: '2026-07-01T00:00:00Z' });
  const tickets = [
    ticket({ key: 'ACME-1', created_at: '2026-07-01T00:00:00Z', linked_prs: [sharedPr] }),
    ticket({ key: 'ACME-2', created_at: '2026-07-01T00:00:00Z', linked_prs: [{ ...sharedPr }] }),
  ];
  const trend = buildEngineeringActivityTrend(tickets, '2026-07-01T12:00:00Z');
  assert.equal(trend.pr_opened_by_day.find((b) => b.date === '2026-07-01').value, 1);
});

test('buildPrActivityTrend reports currently-open count, average age, and a team-level stale list', () => {
  const oldOpenPr = pr({ pr_number: 1, pr_state: 'open', pr_created_at: '2026-06-01T00:00:00Z', pr_merged_at: null });
  const recentOpenPr = pr({
    pr_number: 2,
    pr_state: 'open',
    pr_created_at: '2026-07-25T00:00:00Z',
    pr_merged_at: null,
  });
  const tickets = [ticket({ linked_prs: [oldOpenPr, recentOpenPr] })];
  const trend = buildPrActivityTrend(tickets, '2026-07-30T00:00:00Z', 14);
  assert.equal(trend.currently_open_count, 2);
  assert.equal(trend.stale_pr_count, 1);
  assert.equal(trend.stale_prs[0].pr_number, 1);
  assert.ok(trend.average_open_pr_age_days > 0);
});

test('buildPrActivityTrend never attributes a stale PR to a developer (team-level shape only)', () => {
  const tickets = [ticket({ linked_prs: [pr({ pr_state: 'open', pr_created_at: '2026-06-01T00:00:00Z' })] })];
  const trend = buildPrActivityTrend(tickets, '2026-07-30T00:00:00Z', 14);
  assert.ok(!('assignee_account_id' in trend.stale_prs[0]));
});

test('buildPrActivityTrend breaks PR counts out by repository', () => {
  const tickets = [
    ticket({
      linked_prs: [
        pr({
          repo: 'acme/web-client',
          pr_number: 1,
          pr_state: 'merged',
          pr_created_at: '2026-07-01T00:00:00Z',
          pr_merged_at: '2026-07-02T00:00:00Z',
        }),
      ],
    }),
    ticket({
      linked_prs: [
        pr({
          repo: 'acme/api-server',
          pr_number: 2,
          pr_state: 'open',
          pr_created_at: '2026-07-01T00:00:00Z',
          pr_merged_at: null,
        }),
      ],
    }),
  ];
  const trend = buildPrActivityTrend(tickets, '2026-07-03T00:00:00Z', 14);
  const client = trend.repo_breakdown.find((item) => item.repo === 'acme/web-client');
  const server = trend.repo_breakdown.find((item) => item.repo === 'acme/api-server');
  assert.equal(client.opened_count, 1);
  assert.equal(client.merged_count, 1);
  assert.equal(server.opened_count, 1);
  assert.equal(server.merged_count, 0);
});

test("buildDeveloperActivityTimeline scopes to one developer's own tickets only", () => {
  const tickets = [
    ticket({ assignee_account_id: 'dev-a', resolved_at: '2026-07-05T00:00:00Z' }),
    ticket({ assignee_account_id: 'dev-b', resolved_at: '2026-07-05T00:00:00Z' }),
  ];
  const timeline = buildDeveloperActivityTimeline(tickets, 'dev-a', '2026-07-05T12:00:00Z');
  const completedTotal = timeline.tickets_completed_by_day.reduce((sum, b) => sum + b.value, 0);
  assert.equal(completedTotal, 1);
});

test('buildCycleTimeDistribution reports mean, median, coverage, histogram, and aging tickets', () => {
  const tickets = [
    ticket({ in_progress_to_code_review_hours: 20 }),
    ticket({ in_progress_to_code_review_hours: 50 }),
    ticket({ in_progress_to_code_review_hours: null }),
    ticket({
      status_category: 'indeterminate',
      first_in_progress_at: '2026-07-01T00:00:00Z',
      first_code_review_at_after_in_progress: null,
      in_progress_to_code_review_hours: null,
    }),
  ];
  const dist = buildCycleTimeDistribution(tickets, '2026-07-10T00:00:00Z');
  assert.equal(dist.coverage, 2);
  assert.equal(dist.mean_hours, 35);
  assert.equal(dist.median_hours, 35);
  assert.equal(dist.aging_in_progress.length, 1);
  assert.ok(dist.aging_in_progress[0].days_in_progress > 0);
});

test('buildCycleTimeDistribution shows null mean/median (not 0) with zero coverage', () => {
  const dist = buildCycleTimeDistribution([ticket({ in_progress_to_code_review_hours: null })], '2026-07-10T00:00:00Z');
  assert.equal(dist.mean_hours, null);
  assert.equal(dist.median_hours, null);
  assert.equal(dist.coverage, 0);
});

// --- trend bucketing (readability of long windows) ---

test('chooseBucketPeriod keeps short windows daily and rolls longer ones up', () => {
  assert.equal(chooseBucketPeriod(1), 'day');
  assert.equal(chooseBucketPeriod(70), 'day');
  assert.equal(chooseBucketPeriod(71), 'week');
  assert.equal(chooseBucketPeriod(400), 'week');
  assert.equal(chooseBucketPeriod(401), 'month');
});

test('rollUpBuckets preserves totals and labels each bucket by the period start', () => {
  const daily = [
    { date: '2026-07-01', value: 1 }, // Wednesday
    { date: '2026-07-05', value: 2 }, // Sunday — same ISO week
    { date: '2026-07-06', value: 4 }, // Monday — next week
    { date: '2026-08-02', value: 8 },
  ];
  assert.deepEqual(rollUpBuckets(daily, 'week'), [
    { date: '2026-06-29', value: 3 },
    { date: '2026-07-06', value: 4 },
    { date: '2026-07-27', value: 8 },
  ]);
  assert.deepEqual(rollUpBuckets(daily, 'month'), [
    { date: '2026-07-01', value: 7 },
    { date: '2026-08-01', value: 8 },
  ]);
  assert.deepEqual(rollUpBuckets(daily, 'day'), daily);

  const total = (buckets) => buckets.reduce((sum, b) => sum + b.value, 0);
  for (const period of ['day', 'week', 'month']) {
    assert.equal(total(rollUpBuckets(daily, period)), 15, `total changed for ${period}`);
  }
});

test('resolveTrendWindow spans first to last activity, never past today', () => {
  const window = resolveTrendWindow(
    ['2026-07-10T00:00:00Z', null, '2026-07-01T00:00:00Z', '2026-07-05T00:00:00Z'],
    '2026-09-01T00:00:00Z',
  );
  assert.equal(window.rangeStart, '2026-07-01');
  assert.equal(window.rangeEnd, '2026-07-10'); // clamped to the last event, not today
  assert.equal(window.day_count, 10);
  assert.equal(window.period, 'day');

  // Everything in the future (clock skew / bad data): keep the events rather than blanking the chart.
  const future = resolveTrendWindow(['2026-09-30T00:00:00Z'], '2026-07-01T00:00:00Z');
  assert.equal(future.rangeStart, '2026-09-30');
  assert.equal(future.rangeEnd, '2026-09-30');
  assert.equal(resolveTrendWindow([], '2026-07-01T00:00:00Z'), null);
  assert.equal(resolveTrendWindow([null, undefined], '2026-07-01T00:00:00Z'), null);
});

test('buildEngineeringActivityTrend ignores ticket creation when choosing its window', () => {
  // A ticket filed nine months before anyone touched it must not stretch the
  // chart across nine months of empty days.
  const tickets = [
    ticket({
      created_at: '2025-10-01T00:00:00Z',
      first_in_progress_at: '2026-07-01T00:00:00Z',
      resolved_at: '2026-07-04T00:00:00Z',
      linked_prs: [pr({ pr_created_at: '2026-07-02T00:00:00Z', pr_merged_at: '2026-07-04T00:00:00Z' })],
    }),
  ];
  const trend = buildEngineeringActivityTrend(tickets, '2026-07-10T00:00:00Z');
  assert.equal(trend.bucket_period, 'day');
  assert.equal(trend.day_count, 4);
  assert.equal(trend.tickets_completed_by_day.length, 4);
  assert.equal(trend.tickets_completed_by_day[0].date, '2026-07-01');
});

test('buildEngineeringActivityTrend switches to weekly buckets on a long window', () => {
  const tickets = [
    ticket({
      created_at: '2026-01-01T00:00:00Z',
      first_in_progress_at: '2026-01-05T00:00:00Z',
      resolved_at: '2026-01-06T00:00:00Z',
    }),
    ticket({
      created_at: '2026-01-01T00:00:00Z',
      first_in_progress_at: '2026-06-01T00:00:00Z',
      resolved_at: '2026-06-02T00:00:00Z',
    }),
  ];
  const trend = buildEngineeringActivityTrend(tickets, '2026-06-30T00:00:00Z');
  assert.equal(trend.bucket_period, 'week');
  // ~22 weeks of points instead of ~149 daily ones, with both completions kept.
  assert.ok(trend.tickets_completed_by_day.length < 30, `got ${trend.tickets_completed_by_day.length} points`);
  assert.equal(
    trend.tickets_completed_by_day.reduce((sum, b) => sum + b.value, 0),
    2,
  );
});

test('buildEngineeringActivityTrend returns empty series when nothing has happened yet', () => {
  const trend = buildEngineeringActivityTrend(
    [ticket({ first_in_progress_at: null, resolved_at: null })],
    '2026-07-10T00:00:00Z',
  );
  assert.deepEqual(trend.tickets_completed_by_day, []);
  assert.deepEqual(trend.pr_opened_by_day, []);
});

test('buildPrActivityTrend reports its bucket period and keeps PR totals intact', () => {
  const tickets = [
    ticket({
      linked_prs: [pr({ pr_number: 1, pr_created_at: '2026-01-02T00:00:00Z', pr_merged_at: '2026-01-03T00:00:00Z' })],
    }),
    ticket({
      linked_prs: [pr({ pr_number: 2, pr_created_at: '2026-06-01T00:00:00Z', pr_merged_at: '2026-06-02T00:00:00Z' })],
    }),
  ];
  const trend = buildPrActivityTrend(tickets, '2026-06-30T00:00:00Z', 14);
  assert.equal(trend.bucket_period, 'week');
  assert.equal(
    trend.pr_opened_by_day.reduce((sum, b) => sum + b.value, 0),
    2,
  );
  assert.equal(
    trend.pr_merged_by_day.reduce((sum, b) => sum + b.value, 0),
    2,
  );
});
