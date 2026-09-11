// Shared delivery-math functions. Deliberately plain JS with NO import/export
// syntax: this exact file's text is inlined verbatim into the dashboard's
// <script> tag (see dashboard/render.js) so it runs in the browser as-is. Node
// itself calls these same functions through the small wrapper in
// deliveryMathNode.js, so the dashboard and the CSV validation tool run
// identical math — a validation mismatch means real data disagreement, not two
// independently-buggy reimplementations agreeing with each other.

/**
 * Tickets whose fix_versions intersects the selected release names. Keying the
 * master dataset as a flat map by ticket key (done in render.js) plus this set
 * intersection is what makes "don't double-count a ticket in two selected
 * releases" trivial — a ticket in both stays a single object either way.
 */
function filterTicketsBySelectedReleases(ticketsByKey, selectedReleaseNames) {
  const selected = new Set(selectedReleaseNames);
  return Object.values(ticketsByKey).filter((ticket) =>
    ticket.fix_versions.some((v) => selected.has(v.name)),
  );
}

/**
 * Release-level summary: ticket counts, planned SP / delivered AP totals, and
 * team AI contribution as a null-excluded average paired with its own coverage
 * count (so a low-coverage average is never mistaken for a complete one).
 */
function computeReleaseSummary(tickets) {
  const completedTickets = tickets.filter((t) => t.status_category === 'done').length;
  const totalPlannedSp = tickets.reduce((sum, t) => sum + (typeof t.sp === 'number' ? t.sp : 0), 0);
  const totalDeliveredAp = tickets.reduce((sum, t) => sum + (typeof t.ap === 'number' ? t.ap : 0), 0);
  const aiValues = tickets.map((t) => t.ai_contribution_percent).filter((v) => typeof v === 'number');

  return {
    total_tickets: tickets.length,
    completed_tickets: completedTickets,
    remaining_tickets: tickets.length - completedTickets,
    total_planned_sp: totalPlannedSp,
    total_delivered_ap: totalDeliveredAp,
    team_ai_contribution_percent: aiValues.length ? aiValues.reduce((s, v) => s + v, 0) / aiValues.length : null,
    team_ai_contribution_coverage: aiValues.length,
  };
}

/**
 * Planned Story Points and delivered Actual Points for each release. A ticket
 * assigned to multiple releases appears in each of those releases: this is a
 * release comparison, rather than a deduplicated combined-release summary.
 */
function computeReleasePointComparison(tickets, releaseNames, developerId) {
  const rows = new Map(releaseNames.map((name) => [name, { release_name: name, planned_sp: 0, delivered_ap: 0, ticket_count: 0 }]));

  for (const ticket of tickets) {
    if (developerId && ticket.assignee_account_id !== developerId) continue;
    for (const version of ticket.fix_versions || []) {
      const row = rows.get(version.name);
      if (!row) continue;
      row.ticket_count += 1;
      if (typeof ticket.sp === 'number') row.planned_sp += ticket.sp;
      if (typeof ticket.ap === 'number') row.delivered_ap += ticket.ap;
    }
  }

  return releaseNames.map((name) => rows.get(name));
}

/**
 * Per-developer delivery distribution: ticket count, planned SP, delivered AP,
 * average AI contribution (null-excluded, with its own coverage count), and —
 * relative to the *current* ticket selection only — % of the highest AP
 * delivered by anyone in this selection, and % of the team's total AP. These
 * percentages are NOT precomputed anywhere; they only mean something relative
 * to whichever release(s) are currently selected, so they're always derived
 * fresh from the visible ticket set.
 */
function computeDeveloperDelivery(tickets) {
  const byDev = new Map();

  for (const ticket of tickets) {
    const devId = ticket.assignee_account_id ?? 'unassigned';
    const devName = ticket.assignee_display_name ?? 'Unassigned';
    if (!byDev.has(devId)) {
      byDev.set(devId, {
        assignee_account_id: devId,
        assignee_display_name: devName,
        tickets: [],
        planned_sp: 0,
        delivered_ap: 0,
        ai_values: [],
      });
    }
    const entry = byDev.get(devId);
    entry.tickets.push(ticket);
    if (typeof ticket.sp === 'number') entry.planned_sp += ticket.sp;
    if (typeof ticket.ap === 'number') entry.delivered_ap += ticket.ap;
    if (typeof ticket.ai_contribution_percent === 'number') entry.ai_values.push(ticket.ai_contribution_percent);
  }

  const rows = [...byDev.values()].map((entry) => ({
    assignee_account_id: entry.assignee_account_id,
    assignee_display_name: entry.assignee_display_name,
    ticket_count: entry.tickets.length,
    planned_sp: entry.planned_sp,
    delivered_ap: entry.delivered_ap,
    ai_contribution_percent: entry.ai_values.length
      ? entry.ai_values.reduce((s, v) => s + v, 0) / entry.ai_values.length
      : null,
    ai_contribution_coverage: entry.ai_values.length,
  }));

  const highestAp = rows.reduce((max, r) => Math.max(max, r.delivered_ap), 0);
  const teamAp = rows.reduce((sum, r) => sum + r.delivered_ap, 0);

  return rows.map((r) => ({
    ...r,
    percent_of_highest_ap: highestAp > 0 ? (r.delivered_ap / highestAp) * 100 : null,
    percent_of_team_ap: teamAp > 0 ? (r.delivered_ap / teamAp) * 100 : null,
  }));
}

/**
 * Current snapshot of ticket counts/% by status category (To Do / In Progress /
 * Done). Purely a distribution — no judgment about whether the split is good.
 */
function computeTicketStatusBreakdown(tickets) {
  const labels = { new: 'To Do', indeterminate: 'In Progress', done: 'Done' };
  const counts = { new: 0, indeterminate: 0, done: 0 };

  for (const ticket of tickets) {
    if (ticket.status_category in counts) counts[ticket.status_category] += 1;
  }

  const total = tickets.length;
  return Object.keys(labels).map((category) => ({
    status_category: category,
    label: labels[category],
    count: counts[category],
    percent: total > 0 ? (counts[category] / total) * 100 : null,
  }));
}

/**
 * Ticket count / planned SP / delivered AP faceted by issue type (Bug, Story,
 * Task, etc.) — shows what kind of work made up the selection's delivery.
 */
function computeIssueTypeBreakdown(tickets) {
  const byType = new Map();

  for (const ticket of tickets) {
    const type = ticket.issue_type ?? 'Unspecified';
    if (!byType.has(type)) {
      byType.set(type, { issue_type: type, ticket_count: 0, planned_sp: 0, delivered_ap: 0 });
    }
    const entry = byType.get(type);
    entry.ticket_count += 1;
    if (typeof ticket.sp === 'number') entry.planned_sp += ticket.sp;
    if (typeof ticket.ap === 'number') entry.delivered_ap += ticket.ap;
  }

  return [...byType.values()].sort((a, b) => b.ticket_count - a.ticket_count);
}
