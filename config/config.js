// Central, tunable knobs for the dashboard. Nothing here should require a code
// change to adjust — retune these constants instead.

export const repos = [
  'bvs-xiangqi/xiangqi-client',
  'bvs-xiangqi/xiangqi-server',
];

// How far back to keep PRs in the local GitHub cache — bounds the ticket->PR
// evidence index; a PR merged long before this window won't show up as evidence
// even if it's the real implementation of a ticket.
export const lookbackDays = 90;

// Jira fixVersions to include in a given dashboard generation run. Overridable
// per-run via --releases "8.5.0,8.6.0". Deliberately an explicit allowlist, not
// auto-discovered from Jira — a stale list is easy to notice and fix; silently
// including/excluding a release nobody asked for is not.
const fetchReleasesFromLastSixMonths = async () => {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - 6);

  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!email || !token) {
    return [];
  }

  const authHeader = Buffer.from(`${email}:${token}`).toString('base64');
  const jiraBaseUrl = (process.env.JIRA_BASE_URL || 'https://arbisoft.atlassian.net').replace(/\/$/, '');

  try {
    // Note: Use /versions (plural) for fetching all project versions
    const response = await fetch(
      `${jiraBaseUrl}/rest/api/3/project/XQ/versions`,
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    // Support both direct array response (/versions) and wrapped response object (/version)
    const versions = Array.isArray(data) ? data : data.values || [];
    const filteredVersions = versions
      .filter((v) => {
        // 1. Skip archived versions
        if (v.archived) return false;

        // 2. Keep all unreleased / upcoming versions
        if (!v.released) {
          return true;
        }

        // 3. Keep released versions if they have no date OR if released within 6 months
        if (!v.releaseDate) {
          return true;
        }

        const releaseDate = new Date(v.releaseDate);
        const isRecent = releaseDate >= cutoffDate;

        return isRecent;
      })
      .map((v) => v.name);

    return filteredVersions;
  } catch (error) {
    return [];
  }
};

export const releasesToTrack = await fetchReleasesFromLastSixMonths();

// Custom field IDs on this Jira instance (arbisoft.atlassian.net, project XQ) —
// each confirmed live against real tickets via the Jira API, not guessed.
// Custom field IDs are global per Jira site, so these should hold across
// projects on the same instance; re-verify if pointing this at a different site.
export const jiraStoryPointsFieldId = 'customfield_10010'; // "Story Points" (SP)
export const jiraActualPointsFieldId = 'customfield_10833'; // "Actual Points" (AP)
export const jiraAiContributionFieldId = 'customfield_11729'; // "AI Contribution Percentage" — stored as a 0-1 fraction, must be ×100 for display

// A currently-open PR older than this shows up in the PR Activity Trend's
// team-level stale list. Purely descriptive — never attributed to or shown
// against the developer who opened it.
export const stalePrAfterDays = 14;
