import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getConfig, publicConfig } from './config/index.js';
import { fetchNewOrUpdatedPullRequests, fetchPullRequestActivity } from './fetch/github.js';
import { fetchTicketsByFixVersions } from './fetch/jira.js';
import { fetchTicketChangelog } from './fetch/jiraChangelog.js';
import { resolveReleases } from './fetch/jiraVersions.js';
import { extractTicketId } from './parse/ticketId.js';
import { parseAiChecklist, combineAiSignals } from './parse/aiChecklist.js';
import { computeCommitAiPercent } from './parse/commitCoAuthorship.js';
import { summarizePrReviews } from './parse/prReviews.js';
import { buildTicketPrIndex } from './merge/ticketPrIndex.js';
import { normalizeJiraIssue } from './normalize/ticketRecord.js';
import { renderDashboard } from './dashboard/render.js';
import { mapInBatches } from './utils/concurrency.js';
import {
  readGithubCache,
  writeGithubCache,
  readWatermark,
  writeWatermark,
  writeJiraTicketsCache,
  readJiraChangelogsCache,
  writeJiraChangelogsCache,
  writeOutput,
} from './cache/store.js';
import { log, warn } from './utils/logger.js';

const API_CONCURRENCY = 5;

function parseArgs(argv) {
  const args = { releases: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--releases') args.releases = argv[i + 1];
  }
  return args;
}

/**
 * The cached record for one pull request: identity, linkage to a Jira ticket,
 * AI-contribution signals and code-review timing. Exported for tests.
 */
export function buildPrRecord(repo, rawPr, activity, config = getConfig()) {
  const { ticketId, source } = extractTicketId(rawPr.title, rawPr.body, { projectKey: config.jira.projectKey });
  const aiEnabled = config.aiContribution.enabled;
  const aiContribution = aiEnabled
    ? combineAiSignals(
        parseAiChecklist(rawPr.body, { heading: config.aiContribution.checklistHeading }),
        computeCommitAiPercent(activity.commits, config.aiContribution.coAuthorPatterns),
      )
    : {
        available: false,
        overall_score_percent: null,
        source: 'disabled',
        activities: [],
        checklist_score_percent: null,
        commit_ai_percent: null,
      };

  return {
    id: `${repo}#${rawPr.number}`,
    repo,
    number: rawPr.number,
    title: rawPr.title,
    state: rawPr.merged_at ? 'merged' : rawPr.state,
    created_at: rawPr.created_at,
    merged_at: rawPr.merged_at,
    updated_at: rawPr.updated_at,
    base_branch: rawPr.base?.ref ?? null,
    author_login: rawPr.user?.login ?? null,
    assignee_login: rawPr.assignee?.login ?? null,
    linked_ticket_id: ticketId,
    ticket_source: source,
    ai_contribution: aiContribution,
    review: summarizePrReviews(rawPr, activity.reviews, activity.comments),
    fetched_at: new Date().toISOString(),
  };
}

async function syncRepo(repo, lookbackCutoffIso, config, onProgress) {
  const cache = readGithubCache(repo);
  const watermark = readWatermark(repo);
  const nowIso = new Date().toISOString();

  // On a cold start (no watermark yet) bound the fetch to the lookback window
  // instead of paging through the repo's entire PR history.
  const effectiveWatermark = watermark.lastUpdatedAtSeen ?? lookbackCutoffIso;

  onProgress?.(`Fetching updated pull requests from ${repo}…`);
  const newRawPrs = await fetchNewOrUpdatedPullRequests(repo, effectiveWatermark, config);
  log(`${repo}: ${newRawPrs.length} new/updated PR(s) since ${effectiveWatermark}`);
  onProgress?.(
    newRawPrs.length
      ? `Fetching activity for ${newRawPrs.length} updated pull requests in ${repo}…`
      : `No updated pull requests in ${repo}; using cached activity.`,
  );

  let maxUpdatedAt = watermark.lastUpdatedAtSeen;

  let processed = 0;
  await mapInBatches(newRawPrs, API_CONCURRENCY, async (rawPr) => {
    const activity = await fetchPullRequestActivity(repo, rawPr.number, config);
    cache[rawPr.number] = buildPrRecord(repo, rawPr, activity, config);
    if (!maxUpdatedAt || new Date(rawPr.updated_at) > new Date(maxUpdatedAt)) {
      maxUpdatedAt = rawPr.updated_at;
    }

    // Persist incrementally so a long run's progress isn't all-or-nothing if
    // it's interrupted, and so the cache reflects partial progress on disk.
    writeGithubCache(repo, cache);
    writeWatermark(repo, { lastUpdatedAtSeen: maxUpdatedAt, lastRunAt: nowIso });
    processed += 1;
    onProgress?.(`Fetched pull-request activity ${processed}/${newRawPrs.length} from ${repo}.`);
    if (processed % 10 === 0 || processed === newRawPrs.length) {
      log(`${repo}: processed ${processed}/${newRawPrs.length} PR(s)`);
    }
  });

  if (newRawPrs.length === 0) {
    writeWatermark(repo, { lastUpdatedAtSeen: maxUpdatedAt ?? effectiveWatermark, lastRunAt: nowIso });
  }

  return Object.values(cache);
}

/**
 * Syncs every configured repository. A single repository failing (bad name,
 * revoked access) is reported and skipped so the Jira half of the dashboard
 * still renders; the failure is recorded in the bundle's `warnings`.
 */
async function syncAllRepos(config, warnings, onProgress) {
  const lookbackStart = new Date(Date.now() - config.github.lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const allPrRecords = [];
  for (const repo of config.github.repos) {
    try {
      allPrRecords.push(...(await syncRepo(repo, lookbackStart, config, onProgress)));
    } catch (error) {
      // Keep whatever was cached so a token hiccup degrades to "stale PR
      // evidence" rather than "no PR evidence".
      const cached = Object.values(readGithubCache(repo));
      allPrRecords.push(...cached);
      warn(`GitHub sync failed for ${repo}: ${error.message}`);
      warnings.push(
        `GitHub: could not sync ${repo} (${error.message}). ` +
          (cached.length ? `Showing ${cached.length} previously cached PR(s).` : 'No cached PRs available.'),
      );
      onProgress?.(`Could not fetch ${repo}; showing ${cached.length} cached pull requests.`);
    }
  }
  return allPrRecords;
}

/**
 * Fetches each ticket's status-change history, needed for the In Progress ->
 * Code Review cycle-time metric. Unlike the ticket fields (one cheap bulk JQL
 * call regardless of ticket count), changelog is ~1 API call per ticket, so
 * it's cached per-ticket keyed by that ticket's own Jira `updated` timestamp —
 * `updated` changes on any field edit, not just a status transition, so this
 * is a conservative invalidation key that never under-fetches.
 */
async function syncChangelogs(rawIssues, config, onProgress) {
  const cache = readJiraChangelogsCache();
  const toFetch = rawIssues.filter((issue) => cache[issue.key]?.cachedForUpdated !== issue.fields.updated);
  log(
    `Changelogs: ${toFetch.length} ticket(s) need (re)fetching, ${rawIssues.length - toFetch.length} unchanged since last cache`,
  );
  onProgress?.(
    toFetch.length
      ? `Fetching Jira histories for ${toFetch.length} updated tickets (${rawIssues.length - toFetch.length} cached)…`
      : `Jira histories are up to date (${rawIssues.length} tickets cached).`,
  );

  let processed = 0;
  await mapInBatches(toFetch, API_CONCURRENCY, async (issue) => {
    const values = await fetchTicketChangelog(issue.key, config);
    cache[issue.key] = { cachedForUpdated: issue.fields.updated, values };
    writeJiraChangelogsCache(cache);
    processed += 1;
    onProgress?.(`Fetched Jira history ${processed}/${toFetch.length}: ${issue.key}.`);
    if (processed % 10 === 0 || processed === toFetch.length) {
      log(`Changelogs: fetched ${processed}/${toFetch.length}`);
    }
  });

  const changelogByKey = new Map();
  for (const issue of rawIssues) {
    changelogByKey.set(issue.key, cache[issue.key]?.values ?? []);
  }
  return changelogByKey;
}

/**
 * Generates the dashboard bundle: `{ generated_at, project, features, releases,
 * tickets, warnings, ... }`. Everything the browser needs, and nothing secret.
 *
 * @param {object} options
 * @param {string[]|null} options.releases  explicit release names (overrides discovery)
 * @param {boolean} options.writeOutput     also write data/output/{bundle.json,dashboard.html}
 */
export async function generateDashboard({
  releases: overrideReleases = null,
  writeOutput: shouldWriteOutput = true,
  onProgress,
} = {}) {
  const config = getConfig();
  const now = new Date();
  const warnings = [];

  onProgress?.('Finding Jira releases…');
  const releases = await resolveReleases({ override: overrideReleases, config, now });
  const releaseNames = releases.map((r) => r.name);
  onProgress?.(
    releaseNames.length
      ? `Found ${releaseNames.length} Jira release${releaseNames.length === 1 ? '' : 's'}; preparing dashboard data…`
      : 'No Jira releases found; preparing the dashboard…',
  );
  if (releaseNames.length === 0) {
    warnings.push(
      `Jira: no releases found for project ${config.jira.projectKey}. Create a version (fixVersion) in Jira or set JIRA_RELEASES.`,
    );
  }

  const allPrRecords = config.features.github ? await syncAllRepos(config, warnings, onProgress) : [];

  log(`Fetching Jira tickets for release(s): ${releaseNames.join(', ') || '(none)'}`);
  onProgress?.(`Fetching Jira tickets for ${releaseNames.join(', ') || 'the configured project'}…`);
  const rawIssues = await fetchTicketsByFixVersions(releaseNames, config);
  log(`Found ${rawIssues.length} ticket(s) across the configured release(s)`);
  onProgress?.(`Fetched ${rawIssues.length} Jira tickets; preparing ticket histories…`);

  const ticketPrIndex = buildTicketPrIndex(allPrRecords);
  const changelogByKey = await syncChangelogs(rawIssues, config, onProgress);

  const ticketsByKey = {};
  for (const issue of rawIssues) {
    ticketsByKey[issue.key] = normalizeJiraIssue(issue, ticketPrIndex, changelogByKey, config);
  }
  writeJiraTicketsCache(ticketsByKey);

  const bundle = {
    generated_at: now.toISOString(),
    ...publicConfig(config),
    releases,
    tickets: ticketsByKey,
    warnings,
  };

  if (shouldWriteOutput) {
    writeOutput('bundle.json', bundle);
    const dashboardPath = writeOutput('dashboard.html', renderDashboard(bundle));
    log(`Wrote ${dashboardPath}`);
  }
  onProgress?.('Finishing dashboard update…');
  return bundle;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const releases = args.releases
    ? args.releases
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean)
    : null;
  await generateDashboard({ releases });
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMainModule) {
  main().catch((error) => {
    warn(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
