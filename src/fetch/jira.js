import {
  jiraStoryPointsFieldId,
  jiraActualPointsFieldId,
  jiraAiContributionFieldId,
} from '../../config/config.js';

const PAGE_SIZE = 100;

function authHeader() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    throw new Error('JIRA_EMAIL / JIRA_API_TOKEN are not set (see .env.example)');
  }
  return `Basic ${Buffer.from(email + ':' + token).toString('base64')}`;
}

function jiraHeaders() {
  return {
    Authorization: authHeader(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function toNumberOrThrow(value, fieldName) {
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) {
    throw new Error(`Expected ${fieldName} to be numeric, received ${value}`);
  }
  return numericValue;
}

function normalizeFieldValue(field, value) {
  switch (field) {
    case 'sp':
    case 'story_points':
      return toNumberOrThrow(value, field);
    case 'ap':
    case 'actual_points':
      return toNumberOrThrow(value, field);
    case 'ai_contribution_percent':
    case 'ai_contribution':
      return toNumberOrThrow(value, field) / 100;
    default:
      return value;
  }
}

export function buildJiraFieldUpdatePayload(field, value) {
  const normalizedValue = normalizeFieldValue(field, value);

  switch (field) {
    case 'summary':
      return { fields: { summary: normalizedValue } };
    case 'assignee':
      return normalizedValue === '' || normalizedValue == null
        ? { fields: { assignee: null } }
        : { fields: { assignee: { accountId: String(normalizedValue) } } };
    case 'issue_type':
      return { fields: { issuetype: { name: String(normalizedValue) } } };
    case 'sp':
    case 'story_points':
      return { fields: { [jiraStoryPointsFieldId]: normalizedValue } };
    case 'ap':
    case 'actual_points':
      return { fields: { [jiraActualPointsFieldId]: normalizedValue } };
    case 'ai_contribution_percent':
    case 'ai_contribution':
      return { fields: { [jiraAiContributionFieldId]: normalizedValue } };
    case 'status':
      return { fields: { status: normalizedValue } };
    default:
      return { fields: { [field]: normalizedValue } };
  }
}

const TICKET_FIELDS = [
  'summary',
  'issuetype',
  'status',
  'assignee',
  'fixVersions',
  'created',
  'updated',
  'resolutiondate',
  jiraStoryPointsFieldId,
  jiraActualPointsFieldId,
  jiraAiContributionFieldId,
];

async function fetchTransitions(baseUrl, issueKey) {
  const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'GET',
    headers: jiraHeaders(),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jira API ${response.status} fetching transitions for ${issueKey}: ${body}`);
  }
  return response.json();
}

async function updateIssueStatus(baseUrl, issueKey, statusName) {
  const transitionsResponse = await fetchTransitions(baseUrl, issueKey);
  const transition = transitionsResponse.transitions?.find(
    (candidate) => (candidate.to?.name ?? candidate.name)?.toLowerCase() === String(statusName).toLowerCase(),
  );
  if (!transition) {
    throw new Error(`No Jira transition found for status ${statusName}`);
  }

  const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'POST',
    headers: jiraHeaders(),
    body: JSON.stringify({ transition: { id: transition.id } }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jira API ${response.status} updating status for ${issueKey}: ${body}`);
  }
}

export async function updateJiraIssueField(issueKey, field, value) {
  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) {
    throw new Error('JIRA_BASE_URL is not set (see .env.example)');
  }

  if (field === 'status') {
    await updateIssueStatus(baseUrl, issueKey, value);
    return { key: issueKey, field, value };
  }

  const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: 'PUT',
    headers: jiraHeaders(),
    body: JSON.stringify(buildJiraFieldUpdatePayload(field, value)),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jira API ${response.status} updating ${field} on ${issueKey}: ${body}`);
  }

  return { key: issueKey, field, value };
}

/**
 * Builds a minimal Atlassian Document Format (ADF) doc wrapping plain text.
 * Jira Cloud REST API v3 requires comment bodies in ADF, not plain strings.
 */
export function buildJiraCommentAdf(text) {
  const trimmed = String(text || '').trim();
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: trimmed
          ? [{ type: 'text', text: trimmed }]
          : [],
      },
    ],
  };
}

/**
 * Posts a comment on a Jira issue (used to record, e.g., code-review effort).
 * The body is a plain string; it is converted to ADF for the v3 API.
 */
export async function postJiraComment(issueKey, body) {
  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) {
    throw new Error('JIRA_BASE_URL is not set (see .env.example)');
  }
  const commentText = String(body || '').trim();
  if (!commentText) {
    throw new Error('Comment body must not be empty.');
  }
  const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: 'POST',
    headers: jiraHeaders(),
    body: JSON.stringify({ body: buildJiraCommentAdf(commentText) }),
  });
  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Jira API ${response.status} commenting on ${issueKey}: ${responseBody}`);
  }
  return { key: issueKey, comment: commentText };
}

/**
 * Fetches every Jira issue belonging to any of the given fixVersions, in one JQL
 * query covering the whole set (not one call per release), paginated via
 * `nextPageToken` — the current contract for POST /rest/api/3/search/jql. The
 * older startAt-based /rest/api/3/search endpoint is deprecated (410) on this
 * Jira site, hence this endpoint.
 * Returns raw Jira issue objects; normalize/ticketRecord.js shapes them.
 */
export async function fetchTicketsByFixVersions(releaseNames) {
  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) {
    throw new Error('JIRA_BASE_URL is not set (see .env.example)');
  }
  if (releaseNames.length === 0) return [];

  const versionList = releaseNames.map((name) => `"${name}"`).join(',');
  const jql = `fixVersion in (${versionList}) ORDER BY key`;

  const issues = [];
  let nextPageToken;

  do {
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: jiraHeaders(),
      body: JSON.stringify({
        jql,
        maxResults: PAGE_SIZE,
        fields: TICKET_FIELDS,
        ...(nextPageToken ? { nextPageToken } : {}),
      }),
    });

    if (!response.ok) {
      // eslint-disable-next-line no-await-in-loop
      const body = await response.text();
      throw new Error(
        `Jira API ${response.status} fetching tickets for releases [${releaseNames.join(', ')}]: ${body}`,
      );
    }

    // eslint-disable-next-line no-await-in-loop
    const page = await response.json();
    issues.push(...page.issues);
    nextPageToken = page.isLast ? undefined : page.nextPageToken;
  } while (nextPageToken);

  return issues;
}
