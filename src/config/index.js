// Single source of truth for project configuration.
//
// Everything a team has to change to point this tool at their own Jira project
// and GitHub repositories lives in environment variables (see .env.example and
// docs/CONFIGURATION.md) — never in code. This module reads those variables
// once, validates them, applies defaults, and exposes a plain object that the
// rest of the codebase consumes through `getConfig()`.
//
// Nothing here touches the network. Config is loaded lazily on first use so
// tests can import any module without a real .env, and so a misconfiguration
// surfaces as one readable error listing every problem rather than a cascade of
// "undefined" failures deep inside a fetch call.

const DEFAULTS = Object.freeze({
  PROJECT_NAME: 'Engineering Delivery',
  JIRA_AI_CONTRIBUTION_SCALE: 'fraction',
  JIRA_IN_PROGRESS_STATUSES: 'In Progress',
  JIRA_CODE_REVIEW_STATUSES: 'Code Review',
  JIRA_RELEASE_LOOKBACK_MONTHS: '6',
  GITHUB_LOOKBACK_DAYS: '90',
  GITHUB_STALE_PR_AFTER_DAYS: '14',
  AI_CONTRIBUTION_ENABLED: 'true',
  AI_CHECKLIST_HEADING: 'AI Contribution Checklist',
  AI_COAUTHOR_PATTERNS: 'claude,copilot,cursor,codex,gemini,devin,aider',
  AI_BASE_URL: 'https://api.groq.com/openai/v1',
  AI_MODEL: 'openai/gpt-oss-120b',
  JIRA_EDITING_ENABLED: 'true',
  REVIEW_LOGGING_ENABLED: 'true',
  REVIEW_COMMENT_TEMPLATE: '{reviewer} spent {time} on code review',
  PORT: '3000',
  HOST: '127.0.0.1',
});

const CUSTOM_FIELD_RE = /^customfield_\d+$/;
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]*$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export class ConfigError extends Error {
  constructor(problems) {
    super(
      'Invalid configuration:\n' +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n\nSee .env.example and docs/CONFIGURATION.md.',
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

function read(env, key) {
  const raw = env[key];
  const value = raw == null ? '' : String(raw).trim();
  if (value === '') return DEFAULTS[key] ?? '';
  return value;
}

function readList(env, key) {
  return read(env, key)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBool(env, key, problems) {
  const value = read(env, key).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off', ''].includes(value)) return false;
  problems.push(`${key} must be true or false (got "${value}")`);
  return false;
}

function readInt(env, key, problems, { min = 0 } = {}) {
  const value = Number(read(env, key));
  if (!Number.isInteger(value) || value < min) {
    problems.push(`${key} must be an integer >= ${min} (got "${read(env, key)}")`);
    return Number(DEFAULTS[key]) || min;
  }
  return value;
}

function readOptionalCustomField(env, key, problems) {
  const value = read(env, key);
  if (!value) return null;
  if (!CUSTOM_FIELD_RE.test(value)) {
    problems.push(
      `${key} must look like customfield_12345 (got "${value}"). Run \`npm run jira:fields\` to list your instance's fields.`,
    );
    return null;
  }
  return value;
}

/**
 * Reads and validates configuration from an environment map. Pure: no I/O.
 * Throws a ConfigError listing every problem at once.
 */
export function loadConfig(env = process.env) {
  const problems = [];

  // --- Jira -----------------------------------------------------------------
  const jiraBaseUrl = read(env, 'JIRA_BASE_URL').replace(/\/+$/, '');
  if (!jiraBaseUrl) problems.push('JIRA_BASE_URL is required (e.g. https://your-org.atlassian.net)');
  else if (!/^https:\/\//.test(jiraBaseUrl)) problems.push('JIRA_BASE_URL must start with https://');

  const jiraEmail = read(env, 'JIRA_EMAIL');
  const jiraApiToken = read(env, 'JIRA_API_TOKEN');
  if (!jiraEmail) problems.push('JIRA_EMAIL is required');
  if (!jiraApiToken) problems.push('JIRA_API_TOKEN is required');

  const jiraProjectKey = read(env, 'JIRA_PROJECT_KEY').toUpperCase();
  if (!jiraProjectKey) problems.push('JIRA_PROJECT_KEY is required (e.g. ABC — the prefix of your ticket keys)');
  else if (!PROJECT_KEY_RE.test(jiraProjectKey))
    problems.push(
      `JIRA_PROJECT_KEY must be letters/digits/underscore starting with a letter (got "${jiraProjectKey}")`,
    );

  const storyPointsField = read(env, 'JIRA_STORY_POINTS_FIELD');
  if (!storyPointsField) {
    problems.push(
      'JIRA_STORY_POINTS_FIELD is required (e.g. customfield_10016). Run `npm run jira:fields` to find it.',
    );
  } else if (!CUSTOM_FIELD_RE.test(storyPointsField)) {
    problems.push(`JIRA_STORY_POINTS_FIELD must look like customfield_12345 (got "${storyPointsField}")`);
  }
  const actualPointsField = readOptionalCustomField(env, 'JIRA_ACTUAL_POINTS_FIELD', problems);
  const aiContributionField = readOptionalCustomField(env, 'JIRA_AI_CONTRIBUTION_FIELD', problems);

  const aiScale = read(env, 'JIRA_AI_CONTRIBUTION_SCALE').toLowerCase();
  if (!['fraction', 'percent'].includes(aiScale)) {
    problems.push(`JIRA_AI_CONTRIBUTION_SCALE must be "fraction" (0-1) or "percent" (0-100) (got "${aiScale}")`);
  }

  const inProgressStatuses = readList(env, 'JIRA_IN_PROGRESS_STATUSES');
  const codeReviewStatuses = readList(env, 'JIRA_CODE_REVIEW_STATUSES');
  if (inProgressStatuses.length === 0) problems.push('JIRA_IN_PROGRESS_STATUSES must list at least one status name');
  if (codeReviewStatuses.length === 0) problems.push('JIRA_CODE_REVIEW_STATUSES must list at least one status name');

  const explicitReleases = readList(env, 'JIRA_RELEASES');
  const releaseLookbackMonths = readInt(env, 'JIRA_RELEASE_LOOKBACK_MONTHS', problems, { min: 1 });
  const defaultSelectedReleases = readList(env, 'DEFAULT_RELEASES');
  const issueTypes = readList(env, 'JIRA_ISSUE_TYPES');

  // --- GitHub ---------------------------------------------------------------
  const githubToken = read(env, 'GITHUB_TOKEN');
  const githubRepos = readList(env, 'GITHUB_REPOS');
  for (const repo of githubRepos) {
    if (!REPO_RE.test(repo)) problems.push(`GITHUB_REPOS entry "${repo}" must be in owner/name form`);
  }
  if (githubRepos.length > 0 && !githubToken) {
    problems.push('GITHUB_TOKEN is required when GITHUB_REPOS is set');
  }
  const githubBaseBranch = read(env, 'GITHUB_BASE_BRANCH') || null;
  const lookbackDays = readInt(env, 'GITHUB_LOOKBACK_DAYS', problems, { min: 1 });
  const stalePrAfterDays = readInt(env, 'GITHUB_STALE_PR_AFTER_DAYS', problems, { min: 1 });

  // --- AI contribution ------------------------------------------------------
  const aiContributionEnabled = readBool(env, 'AI_CONTRIBUTION_ENABLED', problems);
  const checklistHeading = read(env, 'AI_CHECKLIST_HEADING');
  const coAuthorPatterns = readList(env, 'AI_COAUTHOR_PATTERNS');

  // --- Assistant (optional) -------------------------------------------------
  const assistantApiKey = read(env, 'AI_API_KEY');
  const assistantBaseUrl = read(env, 'AI_BASE_URL').replace(/\/+$/, '');
  const assistantModel = read(env, 'AI_MODEL');
  const assistantExtraInstructions = read(env, 'ASSISTANT_EXTRA_INSTRUCTIONS');

  // --- Editing / review logging --------------------------------------------
  const jiraEditingEnabled = readBool(env, 'JIRA_EDITING_ENABLED', problems);
  const reviewLoggingEnabled = readBool(env, 'REVIEW_LOGGING_ENABLED', problems);
  const reviewCommentTemplate = read(env, 'REVIEW_COMMENT_TEMPLATE');
  if (!reviewCommentTemplate.includes('{reviewer}') || !reviewCommentTemplate.includes('{time}')) {
    problems.push('REVIEW_COMMENT_TEMPLATE must contain both {reviewer} and {time}');
  }

  // --- Server / deployment --------------------------------------------------
  const port = readInt(env, 'PORT', problems, { min: 1 });
  const isVercel = Boolean(env.VERCEL);
  const dashboardUsername = read(env, 'DASHBOARD_USERNAME');
  const dashboardPassword = read(env, 'DASHBOARD_PASSWORD');
  if ((dashboardUsername && !dashboardPassword) || (!dashboardUsername && dashboardPassword)) {
    problems.push('DASHBOARD_USERNAME and DASHBOARD_PASSWORD must be set together');
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return Object.freeze({
    project: Object.freeze({ name: read(env, 'PROJECT_NAME'), key: jiraProjectKey }),
    jira: Object.freeze({
      baseUrl: jiraBaseUrl,
      email: jiraEmail,
      apiToken: jiraApiToken,
      projectKey: jiraProjectKey,
      fields: Object.freeze({
        storyPoints: storyPointsField,
        actualPoints: actualPointsField,
        aiContribution: aiContributionField,
      }),
      aiContributionScale: aiScale,
      statuses: Object.freeze({
        inProgress: Object.freeze(inProgressStatuses),
        codeReview: Object.freeze(codeReviewStatuses),
      }),
      issueTypes: Object.freeze(issueTypes),
      releases: Object.freeze({
        explicit: explicitReleases.length ? Object.freeze(explicitReleases) : null,
        lookbackMonths: releaseLookbackMonths,
      }),
      defaultSelectedReleases: Object.freeze(defaultSelectedReleases),
    }),
    github: Object.freeze({
      token: githubToken || null,
      repos: Object.freeze(githubRepos),
      baseBranch: githubBaseBranch,
      lookbackDays,
      stalePrAfterDays,
    }),
    aiContribution: Object.freeze({
      enabled: aiContributionEnabled,
      checklistHeading,
      coAuthorPatterns: Object.freeze(coAuthorPatterns),
    }),
    assistant: Object.freeze({
      enabled: Boolean(assistantApiKey),
      apiKey: assistantApiKey || null,
      baseUrl: assistantBaseUrl,
      model: assistantModel,
      extraInstructions: assistantExtraInstructions,
    }),
    reviews: Object.freeze({
      enabled: reviewLoggingEnabled,
      commentTemplate: reviewCommentTemplate,
    }),
    server: Object.freeze({
      port,
      host: read(env, 'HOST'),
      isVercel,
      dataDir: read(env, 'DATA_DIR') || null,
      dashboardUsername: dashboardUsername || null,
      dashboardPassword: dashboardPassword || null,
      cronSecret: read(env, 'CRON_SECRET') || null,
      blobToken: read(env, 'BLOB_READ_WRITE_TOKEN') || null,
    }),
    // Feature flags derived from configuration. The bundle carries these to the
    // browser so the UI hides what a project hasn't configured, instead of
    // showing permanently-empty columns.
    features: Object.freeze({
      github: githubRepos.length > 0,
      actualPoints: Boolean(actualPointsField),
      aiContribution: aiContributionEnabled,
      jiraAiField: aiContributionEnabled && Boolean(aiContributionField),
      assistant: Boolean(assistantApiKey),
      jiraEditing: jiraEditingEnabled,
      reviewLogging: reviewLoggingEnabled,
    }),
  });
}

let cached = null;

/** Cached accessor. Throws ConfigError on first call if configuration is invalid. */
export function getConfig() {
  if (!cached) cached = loadConfig(process.env);
  return cached;
}

/** Test hook: forget the cached config so the next getConfig() re-reads process.env. */
export function resetConfigCache() {
  cached = null;
}

/**
 * The subset of config that is safe to embed in the HTML bundle sent to the
 * browser. Never includes tokens or credentials.
 */
export function publicConfig(config = getConfig()) {
  return {
    project_name: config.project.name,
    project_key: config.project.key,
    jira_base_url: config.jira.baseUrl,
    features: { ...config.features },
    stale_pr_after_days: config.github.stalePrAfterDays,
    default_selected_releases: [...config.jira.defaultSelectedReleases],
  };
}
