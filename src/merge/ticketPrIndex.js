function toEvidence(pr) {
  return {
    repo: pr.repo,
    pr_number: pr.number,
    pr_url: `https://github.com/${pr.repo}/pull/${pr.number}`,
    pr_title: pr.title,
    pr_state: pr.state,
    pr_created_at: pr.created_at ?? null,
    pr_merged_at: pr.merged_at ?? null,
    pr_ai_checklist_percent: pr.ai_contribution?.checklist_score_percent ?? null,
    pr_commit_co_author_percent: pr.ai_contribution?.commit_ai_percent ?? null,
    pr_assignee_login: pr.assignee_login ?? null,
    pr_reviewers: pr.reviewers ?? [],
    pr_time_to_first_review_hours: pr.time_to_first_review_hours ?? null,
    pr_time_to_approval_hours: pr.time_to_approval_hours ?? null,
    pr_review_completion_time_hours: pr.review_completion_time_hours ?? null,
  };
}

/**
 * Groups cached PR records (across all configured repos) by their linked Jira
 * ticket key, for use as supporting evidence on ticket records. A ticket with no
 * cached PR at all simply has no entry in the returned map — the caller (see
 * normalize/ticketRecord.js) treats a missing entry as an empty evidence list,
 * never as a negative signal.
 *
 * Note this index is only as complete as the GitHub PR cache's fetch window
 * (bounded by `lookbackDays`) — a ticket resolved via a PR merged long before
 * that window won't show evidence here even though one exists on GitHub.
 */
export function buildTicketPrIndex(allPrRecords) {
  const index = new Map();
  for (const pr of allPrRecords) {
    if (!pr.linked_ticket_id) continue;
    const evidence = toEvidence(pr);
    if (index.has(pr.linked_ticket_id)) {
      index.get(pr.linked_ticket_id).push(evidence);
    } else {
      index.set(pr.linked_ticket_id, [evidence]);
    }
  }
  return index;
}
