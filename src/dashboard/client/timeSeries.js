// Shared time-series/distribution math. Deliberately plain JS with NO
// import/export syntax — same reason as deliveryMath.js: this exact file's
// text is inlined verbatim into the dashboard's <script> tag, and Node runs
// the identical code via timeSeriesNode.js's vm.runInThisContext bridge.
// Kept as a separate file from deliveryMath.js on purpose: deliveryMath.js is
// selection-relative snapshot rollups (SP/AP sums, %-of-highest), a different
// mathematical shape from the date-bucketing/cumulative/distribution math here.

function toDayString(isoOrDate) {
  if (isoOrDate == null) return null;
  const date = new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function dayRange(startDay, endDay) {
  const days = [];
  let cursor = new Date(`${startDay}T00:00:00.000Z`);
  const end = new Date(`${endDay}T00:00:00.000Z`);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return days;
}

/**
 * Buckets `items` into a continuous day range [rangeStart, rangeEnd] (every
 * day present, even at 0), summing `getValue(item)` for whichever day
 * `getDate(item)` falls on. Pass `() => 1` as getValue to count occurrences
 * instead of summing a numeric field. Items whose date is missing or falls
 * outside the range are skipped, not thrown on.
 */
function bucketByDay(items, getDate, getValue, rangeStart, rangeEnd) {
  const sums = {};
  for (const day of dayRange(rangeStart, rangeEnd)) sums[day] = 0;
  for (const item of items) {
    const dateValue = getDate(item);
    if (!dateValue) continue;
    const day = toDayString(dateValue);
    if (day in sums) sums[day] += getValue(item);
  }
  return Object.entries(sums).map(([date, value]) => ({ date, value }));
}

/** Running-total transform over an already-bucketed [{date, value}] series. */
function cumulativeSeries(buckets) {
  let running = 0;
  return buckets.map((bucket) => {
    running += bucket.value;
    return { date: bucket.date, value: running };
  });
}

/** Null-safe mean — excludes non-numeric/missing values, returns null (never 0) if none remain. */
function computeMean(values) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (nums.length === 0) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

/** Null-safe median — same exclusion rule as computeMean. */
function computeMedian(values) {
  const nums = values
    .filter((v) => typeof v === 'number' && !Number.isNaN(v))
    .slice()
    .sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

/**
 * Fixed-range histogram — no dynamic binning, just counts values into
 * caller-supplied {label, min, max} ranges (max exclusive; use Infinity for an
 * open-ended last bucket). Keeps the shape simple and predictable rather than
 * an adaptive algorithm nobody asked for.
 */
function computeHistogramBuckets(values, ranges) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  return ranges.map((range) => ({
    label: range.label,
    count: nums.filter((v) => v >= range.min && v < range.max).length,
  }));
}

/** Every linked PR across `tickets`, deduped by repo:number in case one PR ever attaches to more than one ticket. */
function dedupeLinkedPrs(tickets) {
  const seen = new Map();
  for (const ticket of tickets) {
    for (const pr of ticket.linked_prs) {
      const key = `${pr.repo}:${pr.pr_number}`;
      if (!seen.has(key)) seen.set(key, pr);
    }
  }
  return [...seen.values()];
}

function earliestDay(isoDates) {
  const present = isoDates
    .map((value) => toDayString(value))
    .filter(Boolean);
  if (present.length === 0) return null;
  return present.reduce((min, d) => (d < min ? d : min));
}

/**
 * Release momentum: a flat "planned SP" reference for the current selection,
 * with cumulative delivered AP and cumulative tickets-completed rising toward
 * it over time (by resolved_at) — shows steady vs. back-loaded delivery.
 * Deliberately NOT a scope-growth line: fixVersion-membership changes aren't
 * reliably reconstructable from what's fetched.
 */
function buildReleaseProgressSeries(tickets, nowIso) {
  const now = nowIso ?? new Date().toISOString();
  const totalPlannedSp = tickets.reduce((sum, t) => sum + (typeof t.sp === 'number' ? t.sp : 0), 0);

  const rangeStart = earliestDay(tickets.map((t) => t.created_at));
  if (!rangeStart) {
    return { total_planned_sp: totalPlannedSp, cumulative_ap_by_day: [], cumulative_tickets_completed_by_day: [] };
  }
  const rangeEnd = toDayString(now);
  const resolvedTickets = tickets.filter((t) => t.resolved_at);

  return {
    total_planned_sp: totalPlannedSp,
    cumulative_ap_by_day: cumulativeSeries(
      bucketByDay(resolvedTickets, (t) => t.resolved_at, (t) => (typeof t.ap === 'number' ? t.ap : 0), rangeStart, rangeEnd),
    ),
    cumulative_tickets_completed_by_day: cumulativeSeries(
      bucketByDay(resolvedTickets, (t) => t.resolved_at, () => 1, rangeStart, rangeEnd),
    ),
  };
}

/**
 * Was the team active throughout the selection or was activity concentrated
 * in bursts — per-day counts of PR opened, PR merged, ticket moved to In
 * Progress, ticket completed. Explicitly NOT an "activity score" — no code
 * review data here (would require reintroducing removed GitHub review calls
 * for a soft "if reliable" requirement).
 */
function buildEngineeringActivityTrend(tickets, nowIso) {
  const now = nowIso ?? new Date().toISOString();
  const prs = dedupeLinkedPrs(tickets);

  const rangeStart = earliestDay([
    ...tickets.map((t) => t.created_at),
    ...prs.map((p) => p.pr_created_at),
  ]);
  if (!rangeStart) {
    return {
      pr_opened_by_day: [],
      pr_merged_by_day: [],
      tickets_in_progress_by_day: [],
      tickets_completed_by_day: [],
    };
  }
  const rangeEnd = toDayString(now);

  return {
    pr_opened_by_day: bucketByDay(prs, (p) => p.pr_created_at, () => 1, rangeStart, rangeEnd),
    pr_merged_by_day: bucketByDay(prs, (p) => p.pr_merged_at, () => 1, rangeStart, rangeEnd),
    tickets_in_progress_by_day: bucketByDay(tickets, (t) => t.first_in_progress_at, () => 1, rangeStart, rangeEnd),
    tickets_completed_by_day: bucketByDay(tickets, (t) => t.resolved_at, () => 1, rangeStart, rangeEnd),
  };
}

/**
 * PR-side view connecting engineering activity to delivery: opened/merged
 * over time, how many are currently open, average age of open PRs, and a
 * team-level (never per-developer) count/list of PRs open longer than
 * `stalePrAfterDays` — a fact about the PRs, not a flag on whoever opened them.
 */
function buildPrActivityTrend(tickets, nowIso, stalePrAfterDays) {
  const now = nowIso ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();
  const prs = dedupeLinkedPrs(tickets);
  const openPrs = prs.filter((p) => p.pr_state === 'open');
  const repoBreakdown = new Map();

  const ageInDays = (pr) => (nowMs - new Date(pr.pr_created_at).getTime()) / (1000 * 60 * 60 * 24);
  const openAges = openPrs.filter((p) => p.pr_created_at).map(ageInDays);
  const stalePrs = openPrs
    .filter((p) => p.pr_created_at && ageInDays(p) > stalePrAfterDays)
    .map((p) => ({ ...p, days_open: Math.round(ageInDays(p)) }))
    .sort((a, b) => b.days_open - a.days_open);

  for (const pr of prs) {
    const repo = pr.repo ?? 'unknown';
    if (!repoBreakdown.has(repo)) {
      repoBreakdown.set(repo, {
        repo,
        opened_count: 0,
        merged_count: 0,
        open_count: 0,
        stale_count: 0,
        open_prs: [],
      });
    }
    const bucket = repoBreakdown.get(repo);
    bucket.opened_count += 1;
    if (pr.pr_state === 'merged') bucket.merged_count += 1;
    if (pr.pr_state === 'open') {
      bucket.open_count += 1;
      bucket.open_prs.push(pr);
    }
  }
  const rangeStart = earliestDay(prs.map((p) => p.pr_created_at));
  const rangeEnd = toDayString(now);

  return {
    total_prs: prs.length,
    pr_opened_by_day: rangeStart ? bucketByDay(prs, (p) => p.pr_created_at, () => 1, rangeStart, rangeEnd) : [],
    pr_merged_by_day: rangeStart ? bucketByDay(prs, (p) => p.pr_merged_at, () => 1, rangeStart, rangeEnd) : [],
    currently_open_count: openPrs.length,
    average_open_pr_age_days: computeMean(openAges),
    stale_pr_after_days: stalePrAfterDays,
    stale_pr_count: stalePrs.length,
    stale_prs: stalePrs,
    repo_breakdown: [...repoBreakdown.values()].sort((a, b) => b.opened_count - a.opened_count || a.repo.localeCompare(b.repo)),
  };
}

/**
 * A single developer's own activity over time (tickets completed, PRs
 * opened/merged) — sourced entirely via their assigned tickets' linked_prs,
 * not GitHub PR authorship (this project deliberately has no GitHub-login-to-
 * Jira-account mapping). Explicitly a personal timeline, never compared
 * against anyone else.
 */
function buildDeveloperActivityTimeline(tickets, accountId, nowIso) {
  const devTickets = tickets.filter((t) => t.assignee_account_id === accountId);
  const trend = buildEngineeringActivityTrend(devTickets, nowIso);
  return {
    tickets_completed_by_day: trend.tickets_completed_by_day,
    pr_opened_by_day: trend.pr_opened_by_day,
    pr_merged_by_day: trend.pr_merged_by_day,
  };
}

/**
 * In Progress -> Code Review cycle time: mean AND median (averages alone
 * mislead here), a fixed-bucket histogram showing the distribution's shape,
 * and a capped list of tickets currently aging in "In Progress" with no
 * Code Review transition yet.
 */
function buildCycleTimeDistribution(tickets, nowIso) {
  const now = nowIso ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();
  const hours = tickets.map((t) => t.in_progress_to_code_review_hours).filter((v) => typeof v === 'number');

  const histogramRanges = [
    { label: '<1d', min: 0, max: 24 },
    { label: '1-2d', min: 24, max: 48 },
    { label: '2-4d', min: 48, max: 96 },
    { label: '4-7d', min: 96, max: 168 },
    { label: '7-14d', min: 168, max: 336 },
    { label: '14d+', min: 336, max: Infinity },
  ];

  const agingInProgress = tickets
    .filter(
      (t) =>
        t.first_in_progress_at &&
        !t.first_code_review_at_after_in_progress &&
        t.status_category === 'indeterminate',
    )
    .map((t) => ({
      key: t.key,
      summary: t.summary,
      days_in_progress: (nowMs - new Date(t.first_in_progress_at).getTime()) / (1000 * 60 * 60 * 24),
    }))
    .sort((a, b) => b.days_in_progress - a.days_in_progress)
    .slice(0, 10);

  return {
    mean_hours: computeMean(hours),
    median_hours: computeMedian(hours),
    coverage: hours.length,
    total_tickets: tickets.length,
    histogram: computeHistogramBuckets(hours, histogramRanges),
    aging_in_progress: agingInProgress,
  };
}
