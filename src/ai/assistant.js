import { computeReleaseSummary, filterTicketsBySelectedReleases } from '../dashboard/client/deliveryMathNode.js';
import { getConfig } from '../config/index.js';
import {
  EDITABLE_FIELDS as JIRA_EDITABLE_FIELDS,
  fetchJiraIssue,
  updateJiraIssueField,
  postJiraComment,
} from '../fetch/jira.js';
import { assertIssueKey } from '../fetch/jiraClient.js';
import { searchPullRequests } from '../fetch/github.js';
import { formatReviewComment } from '../reviews/service.js';

// Optional "ask a question" assistant. It talks to any OpenAI-compatible
// chat-completions endpoint that supports tool calling (AI_BASE_URL / AI_MODEL /
// AI_API_KEY) and can only answer from the dashboard bundle through the tools
// below. Jira writes are always proposed first and applied only after the
// user confirms in the UI.

const MAX_TOOL_ROUNDS = 8;
/** Preferred chat-completion models, ordered. All of these support tool
 * calling (verified against the Groq API) — required by the assistant loop.
 * Groq retires models over time, so discovery drops whatever no longer exists.
 * Note: Groq's developer plan bills per token (no zero-cost tier left), but
 * gpt-oss-20b/120b cost ~$0.075-$0.60 per 1M tokens — fractions of a cent per
 * assistant query. */
const FALLBACK_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.6-27b',
  'qwen/qwen3.8-27b',
  'meta-llama/llama-3.3-70b-versatile',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama-3.1-8b-instant',
];
/** Models that exist on providers but cannot serve chat completions (e.g. TTS like canopylabs/orpheus-arabic-saudi). */
const NON_CHAT_MODEL_PATTERN = /whisper|guard|tts|orpheus|embed|distil-|safeguard/i;
let modelCandidates = null; // { baseUrl, names: [] } ordered list of usable models
let lastSelectedModel = null;
const EDITABLE_FIELDS = new Set(JIRA_EDITABLE_FIELDS);

// Loose aliases people use for repositories, mapped onto words that commonly
// appear in repository names. Only applied when a configured repo name
// actually contains the target word.
const REPO_ALIASES = [
  {
    words: ['fe', 'frontend', 'front-end', 'front end', 'client', 'web', 'ui', 'app'],
    targets: ['client', 'frontend', 'web', 'ui', 'app'],
  },
  { words: ['be', 'backend', 'back-end', 'back end', 'server', 'api'], targets: ['server', 'backend', 'api'] },
  { words: ['mobile', 'ios', 'android'], targets: ['mobile', 'ios', 'android'] },
];

/**
 * Resolves a free-text repository reference ("backend", "the client",
 * "acme-server") to one of the configured owner/name repos, or null.
 */
export function matchConfiguredRepo(query, repos) {
  if (!query || repos.length === 0) return null;
  const q = String(query).toLowerCase().trim();
  const exact = repos.find((repo) => repo.toLowerCase() === q || repo.split('/')[1].toLowerCase() === q);
  if (exact) return exact;
  const contains = repos.find((repo) => q.includes(repo.split('/')[1].toLowerCase()) || repo.toLowerCase().includes(q));
  if (contains) return contains;
  for (const alias of REPO_ALIASES) {
    if (!alias.words.some((word) => q === word || q.includes(word))) continue;
    const hit = repos.find((repo) => alias.targets.some((target) => repo.split('/')[1].toLowerCase().includes(target)));
    if (hit) return hit;
  }
  return null;
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'search_tickets',
      description: 'Find Jira tickets in dashboard data by release, developer, status, issue key, or text.',
      parameters: {
        type: 'object',
        properties: {
          release: { type: 'string' },
          developer: { type: 'string' },
          status: { type: 'string' },
          text: { type: 'string', description: 'Ticket key or summary substring.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_prs',
      description:
        'Search the linked GitHub PRs in the dashboard data by state, author, reviewer, repo, linked ticket key, or title/number.',
      parameters: {
        type: 'object',
        properties: {
          state: { type: 'string', enum: ['open', 'merged', 'closed', 'all'] },
          author: { type: 'string' },
          reviewer: { type: 'string' },
          repo: { type: 'string' },
          ticket_key: { type: 'string', description: 'Associated Jira ticket key.' },
          number: { type: 'integer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_live_github_prs',
      description:
        'Fetch live pull requests directly from GitHub REST API if data is missing from the dashboard bundle.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          state: { type: 'string', enum: ['open', 'closed', 'all'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_live_jira_issue',
      description: 'Fetch details for a specific issue key directly from Jira REST API.',
      parameters: {
        type: 'object',
        required: ['issueKey'],
        properties: {
          issueKey: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_release_summary',
      description:
        'Calculate ticket count, planned story points, delivered actual points, and AI contribution for one or more releases.',
      parameters: {
        type: 'object',
        required: ['releases'],
        properties: { releases: { type: 'array', items: { type: 'string' }, minItems: 1 } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_delivery_snapshot',
      description:
        'Aggregate delivery metrics (ticket count, planned SP, delivered AP, AI contribution) broken down by release and by developer, plus status and issue-type distributions. Best for \u201chow is the team doing\u201d, \u201cwho delivered what\u201d, and for building comparison charts.',
      parameters: {
        type: 'object',
        properties: {
          releases: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional; restrict the snapshot to these release names.',
          },
          developer: { type: 'string', description: 'Optional; only this developer/metrics for them.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_jira_update',
      description:
        'Propose an update to a Jira ticket. This never writes data; the user must explicitly confirm the proposal.',
      parameters: {
        type: 'object',
        required: ['issueKey', 'field', 'value'],
        properties: {
          issueKey: { type: 'string' },
          field: { type: 'string', enum: [...EDITABLE_FIELDS] },
          value: { type: ['string', 'number', 'null'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_code_review',
      description:
        'Record who spent how long reviewing a ticket. Returns a proposal the user must confirm; once confirmed, a comment naming the reviewer and time spent is added to the Jira ticket. time_spent is a short human duration like "2h", "1d 4h", or "45m".',
      parameters: {
        type: 'object',
        required: ['issueKey', 'reviewer', 'time_spent'],
        properties: {
          issueKey: { type: 'string', description: 'Jira ticket key.' },
          reviewer: { type: 'string', description: 'Reviewer display name or GitHub login.' },
          time_spent: { type: 'string', description: 'Free-text duration, e.g. "2h" or "1d 4h".' },
          pr_number: { type: 'integer', description: 'Optional PR number the review was on.' },
        },
      },
    },
  },
];

function requireApiKey() {
  const { apiKey } = getConfig().assistant;
  if (!apiKey) throw new Error('AI_API_KEY is not configured in environment.');
  return apiKey;
}

function compactTicket(ticket) {
  return {
    key: ticket.key,
    summary: ticket.summary,
    issue_type: ticket.issue_type,
    status: ticket.status,
    assignee: ticket.assignee_display_name,
    sp: ticket.sp,
    ap: ticket.ap,
    ai_contribution_percent: ticket.ai_contribution_percent,
    releases: (ticket.fix_versions || []).map((version) => version.name),
    jira_url: ticket.jira_url,
    linked_prs: (ticket.linked_prs || []).map((pr) => ({
      repo: pr.repo,
      number: pr.pr_number,
      title: pr.pr_title,
      state: pr.pr_state,
      url: pr.pr_url,
      author: pr.pr_author_login ?? null,
      reviewers: pr.pr_reviewers ?? [],
      time_to_first_review_hours: pr.pr_time_to_first_review_hours ?? null,
    })),
  };
}

function allTickets(bundle) {
  return Object.values(bundle.tickets ?? {});
}

function findDeveloper(ticket, value) {
  if (!value) return true;
  const needle = value.toLowerCase();
  return [ticket.assignee_display_name, ticket.assignee_account_id].some((candidate) =>
    String(candidate ?? '')
      .toLowerCase()
      .includes(needle),
  );
}

async function runTool(name, args, bundle) {
  if (name === 'search_tickets') {
    let tickets = allTickets(bundle);
    if (args.release)
      tickets = tickets.filter((ticket) =>
        (ticket.fix_versions || []).some((version) => version.name === args.release),
      );
    if (args.developer) tickets = tickets.filter((ticket) => findDeveloper(ticket, args.developer));
    if (args.status) tickets = tickets.filter((ticket) => ticket.status?.toLowerCase() === args.status.toLowerCase());
    if (args.text) {
      const needle = args.text.toLowerCase();
      tickets = tickets.filter((ticket) => `${ticket.key} ${ticket.summary}`.toLowerCase().includes(needle));
    }
    const limit = 50;
    return {
      total_matches: tickets.length,
      returned_count: Math.min(tickets.length, limit),
      tickets: tickets.slice(0, limit).map(compactTicket),
    };
  }

  if (name === 'search_prs') {
    const targetState = (args.state || 'all').toLowerCase();
    const prMap = new Map();
    for (const ticket of allTickets(bundle)) {
      for (const pr of ticket.linked_prs || []) {
        const key = `${pr.repo}#${pr.pr_number}`;
        if (prMap.has(key)) continue;
        prMap.set(key, {
          id: key,
          repo: pr.repo,
          number: pr.pr_number,
          title: pr.pr_title,
          state: pr.pr_state,
          url: pr.pr_url,
          author: pr.pr_author_login ?? null,
          assignee: pr.pr_assignee_login ?? null,
          reviewers: pr.pr_reviewers ?? [],
          ticket_key: ticket.key,
          ticket_assignee: ticket.assignee_display_name ?? null,
          created_at: pr.pr_created_at ?? null,
          merged_at: pr.pr_merged_at ?? null,
          time_to_first_review_hours: pr.pr_time_to_first_review_hours ?? null,
          time_to_approval_hours: pr.pr_time_to_approval_hours ?? null,
          review_completion_time_hours: pr.pr_review_completion_time_hours ?? null,
        });
      }
    }

    let allPrs = Array.from(prMap.values());
    if (targetState !== 'all') allPrs = allPrs.filter((pr) => pr.state === targetState);
    if (args.ticket_key) {
      const needle = String(args.ticket_key).toLowerCase();
      allPrs = allPrs.filter(
        (pr) =>
          pr.ticket_key.toLowerCase() === needle ||
          String(pr.title || '')
            .toLowerCase()
            .includes(needle),
      );
    }
    if (args.number) allPrs = allPrs.filter((pr) => Number(pr.number) === Number(args.number));
    if (args.author) {
      const needle = String(args.author).toLowerCase();
      allPrs = allPrs.filter((pr) =>
        [pr.author, pr.assignee, pr.ticket_assignee].some((v) =>
          String(v || '')
            .toLowerCase()
            .includes(needle),
        ),
      );
    }
    if (args.reviewer) {
      const needle = String(args.reviewer).toLowerCase();
      allPrs = allPrs.filter((pr) => pr.reviewers.some((r) => String(r).toLowerCase().includes(needle)));
    }
    if (args.repo) {
      const repo = matchConfiguredRepo(args.repo, getConfig().github.repos);
      const needle = (repo ?? String(args.repo)).toLowerCase();
      allPrs = allPrs.filter((pr) =>
        String(pr.repo || '')
          .toLowerCase()
          .includes(needle),
      );
    }

    const limit = 50;
    return { total_found: allPrs.length, returned_count: Math.min(allPrs.length, limit), prs: allPrs.slice(0, limit) };
  }

  if (name === 'fetch_live_github_prs') {
    const { repos } = getConfig().github;
    if (repos.length === 0) return { error: 'No GitHub repositories are configured (GITHUB_REPOS).' };
    const targetRepo = matchConfiguredRepo(args.repo, repos) ?? repos[0];
    try {
      const data = await searchPullRequests(targetRepo, args.state || 'open');
      return {
        target_repo: targetRepo,
        total_found: data.total_count,
        prs: (data.items || []).slice(0, 10).map((pr) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          author: pr.user?.login,
          url: pr.html_url,
        })),
      };
    } catch (err) {
      return { error: `Failed to fetch live GitHub PRs: ${err.message}` };
    }
  }

  if (name === 'fetch_live_jira_issue') {
    try {
      const data = await fetchJiraIssue(assertIssueKey(args.issueKey));
      return {
        key: data.key,
        summary: data.fields?.summary,
        status: data.fields?.status?.name,
        assignee: data.fields?.assignee?.displayName,
        issue_type: data.fields?.issuetype?.name,
        fix_versions: (data.fields?.fixVersions || []).map((v) => v.name),
      };
    } catch (err) {
      return { error: `Failed to fetch live Jira issue: ${err.message}` };
    }
  }

  if (name === 'get_release_summary') {
    const tickets = filterTicketsBySelectedReleases(bundle.tickets ?? {}, args.releases);
    return { releases: args.releases, summary: computeReleaseSummary(tickets) };
  }

  if (name === 'get_delivery_snapshot') {
    const toNum = (v) => (typeof v === 'number' ? v : 0);

    // Select scope: either a specific release set, everything, or one developer.
    let scope = args?.releases?.length
      ? filterTicketsBySelectedReleases(bundle.tickets ?? {}, args.releases)
      : allTickets(bundle);
    if (args?.developer) scope = scope.filter((t) => findDeveloper(t, args.developer));

    const releaseMap = new Map();
    const devMap = new Map();
    const typeMap = new Map();
    const statuses = {
      new: { label: 'To Do', count: 0 },
      indeterminate: { label: 'In Progress', count: 0 },
      done: { label: 'Done', count: 0 },
    };

    const ensureDev = (t) => {
      const id = t.assignee_account_id ?? 'unassigned';
      if (!devMap.has(id)) {
        devMap.set(id, { name: t.assignee_display_name || 'Unassigned', tickets: 0, sp: 0, ap: 0, ai: [] });
      }
      return devMap.get(id);
    };
    const ensureType = (t) => {
      const key = t.issue_type || 'Unspecified';
      if (!typeMap.has(key)) typeMap.set(key, { issue_type: key, tickets: 0, sp: 0, ap: 0 });
      return typeMap.get(key);
    };

    for (const t of scope) {
      for (const v of t.fix_versions || []) {
        if (!releaseMap.has(v.name)) releaseMap.set(v.name, { name: v.name, tickets: 0, sp: 0, ap: 0 });
        const r = releaseMap.get(v.name);
        r.tickets += 1;
        r.sp += toNum(t.sp);
        r.ap += toNum(t.ap);
      }
      const d = ensureDev(t);
      d.tickets += 1;
      d.sp += toNum(t.sp);
      d.ap += toNum(t.ap);
      if (typeof t.ai_contribution_percent === 'number') d.ai.push(t.ai_contribution_percent);
      if (t.status_category in statuses) statuses[t.status_category].count += 1;
      const ty = ensureType(t);
      ty.tickets += 1;
      ty.sp += toNum(t.sp);
      ty.ap += toNum(t.ap);
    }

    const developers = [...devMap.values()]
      .map((d) => ({
        name: d.name,
        tickets: d.tickets,
        planned_sp: d.sp,
        delivered_ap: d.ap,
        ai_contribution_percent: d.ai.length ? d.ai.reduce((s, v) => s + v, 0) / d.ai.length : null,
        ai_coverage: d.ai.length,
      }))
      .sort((a, b) => b.delivered_ap - a.delivered_ap);

    return {
      scope: { total_tickets: scope.length, releases: args?.releases || null },
      releases: [...releaseMap.values()].sort((a, b) => b.sp - a.sp),
      developers,
      statuses: Object.keys(statuses).map((k) => statuses[k]),
      issue_types: [...typeMap.values()].sort((a, b) => b.tickets - a.tickets),
    };
  }

  if (name === 'propose_jira_update') {
    if (!EDITABLE_FIELDS.has(args.field)) throw new Error(`Field ${args.field} cannot be edited by the assistant.`);
    const ticket = bundle.tickets?.[args.issueKey];
    if (!ticket) throw new Error(`Ticket ${args.issueKey} is not in the current dashboard data.`);
    return {
      confirmation_required: true,
      action: { issueKey: args.issueKey, field: args.field, value: args.value },
      ticket: compactTicket(ticket),
    };
  }

  if (name === 'record_code_review') {
    const issueKey = String(args.issueKey ?? '').trim();
    const reviewer = String(args.reviewer ?? '')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 80);
    const timeSpent = String(args.time_spent ?? '')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 40);
    const prNumber = Number.isInteger(args.pr_number) ? args.pr_number : null;
    const ticket = bundle.tickets?.[issueKey];
    if (!ticket) throw new Error(`Ticket ${issueKey} is not in the current dashboard data.`);
    if (!reviewer || !timeSpent)
      throw new Error(
        'Both reviewer and time_spent are required. Use record_code_review(issueKey, reviewer, time_spent).',
      );
    return {
      confirmation_required: true,
      action: { type: 'review_comment', issueKey, reviewer, time_spent: timeSpent, pr_number: prNumber },
      ticket: compactTicket(ticket),
    };
  }

  throw new Error(`Unknown assistant tool: ${name}`);
}

async function callModel(messages, model) {
  const { baseUrl } = getConfig().assistant;
  const apiKey = requireApiKey();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages,
      tools,
      tool_choice: 'auto',
    }),
  });
  if (!response.ok) throw new Error(`AI API ${response.status}: ${await response.text()}`);
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when the thrown error is a provider rate-limit (HTTP 429 or a body code). */
function isRateLimitError(error) {
  if (error instanceof Error && /429|rate_limit|rate limit|rate-limit/i.test(error.message)) return true;
  return false;
}

/** True when the selected model cannot serve chat completions (e.g. a TTS model). */
function isUnsupportedModelError(error) {
  if (!(error instanceof Error)) return false;
  if (/does not support chat completions|not supported for chat/i.test(error.message)) return true;
  // Provider no longer offers the model (or access was revoked) — fail over.
  if (/model_not_found|does not exist or you do not have access/i.test(error.message)) return true;
  return false;
}

/** Best-effort wait (seconds) suggested by the provider for a 429; bounded. */
function rateLimitWaitSeconds(error) {
  const match = String(error?.message || '').match(/try again in ([\d.]+)s?/i);
  if (match) return Math.max(1, Math.min(Number(match[1]), 12));
  return 3;
}

/**
 * Ordered list of usable models for a base URL, cached. Never an empty list —
 * falls back to the configured model even if discovery fails.
 */
async function getModelCandidates(baseUrl, apiKey) {
  if (modelCandidates?.baseUrl === baseUrl) return modelCandidates.names;

  const configuredModel = getConfig().assistant.model;
  let names = [configuredModel, ...FALLBACK_MODELS].filter((name) => !NON_CHAT_MODEL_PATTERN.test(name));
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (response.ok) {
      const records = (await response.json()).data ?? [];
      const known = new Set(records.map((record) => record.id));
      // Only ever use models known to support chat completions. Never promote
      // arbitrary discovered models — providers list TTS/ASR/moderation models
      // (e.g. canopylabs/orpheus-arabic-saudi) that reject chat requests.
      // Models retired by the provider are dropped automatically.
      const chatCapable = names.filter((name) => known.has(name));
      if (chatCapable.length) names = chatCapable;
    }
  } catch {
    // keep the static list
  }
  modelCandidates = { baseUrl, names };
  return names;
}

/**
 * Pick the preferred model that hasn't been rate-limited in this request yet.
 * Opportunity to fail over to a different (free) model when one is throttled.
 */
function pickModel(candidates, used) {
  return candidates.find((name) => !used.has(name)) ?? null;
}

async function resolveModel(baseUrl, apiKey) {
  const candidates = await getModelCandidates(baseUrl, apiKey);
  const configuredModel = getConfig().assistant.model;
  const model = candidates.includes(configuredModel) ? configuredModel : candidates[0];
  if (lastSelectedModel && candidates.includes(lastSelectedModel)) return lastSelectedModel;
  lastSelectedModel = model;
  return model;
}

export async function answerAssistantQuestion(bundle, messages) {
  const formattedHistory = (Array.isArray(messages) ? messages : [])
    .filter((msg) => msg && msg.role && msg.content)
    .slice(-8)
    .map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: String(msg.content),
    }));

  const config = getConfig();
  const repoList = config.github.repos.length
    ? `Repositories: ${config.github.repos.map((r) => r.split('/')[1]).join(', ')}. `
    : 'No GitHub repositories are configured; PR tools will return nothing. ';
  const pointsGlossary = config.features.actualPoints
    ? 'Planned SP = estimated story points; Delivered AP = actual points. '
    : 'Planned SP = estimated story points; actual points are not tracked on this project. ';
  const aiGlossary = config.features.aiContribution
    ? 'AI contribution is 0-100%. '
    : 'AI contribution is not tracked on this project. ';

  const conversation = [
    {
      role: 'system',
      content:
        `You are the engineering delivery assistant for the ${config.project.name} team (Jira project ${config.project.key}). Answer ONLY from data returned by your tools — never invent numbers. ` +
        'Use exact tool names: search_tickets, search_prs, get_release_summary, get_delivery_snapshot, propose_jira_update, record_code_review, fetch_live_github_prs, fetch_live_jira_issue. ' +
        repoList +
        pointsGlossary +
        aiGlossary +
        'Answer style: lead with one crisp takeaway sentence, then 2-5 tight bullets (bold key numbers with ** **). Keep it under ~110 words. ' +
        'When you answer a numeric comparison across categories (developers, releases, statuses, or issue types), append ONE chart block so the UI can render a bar chart. ' +
        'Use this exact format (code-fence labelled chart, JSON on the same lines):\n' +
        '```chart\n{"title":"Planned vs Delivered by Release","categories":["1.1.0","1.2.0"],"series":[{"name":"Planned SP","values":[10,24]},{"name":"Delivered AP","values":[8,21]}]}\n```\n' +
        'Chart rules: values must be numbers; categories length must equal each series values length; title is short; up to 3 series. ' +
        'If the data is a single fact or you are unsure, skip the chart and just answer in prose. ' +
        'For evidence links (GitHub PR or Jira URLs) always use normal markdown links [text](https://...) — never image syntax ![](url), since those pages are not images and would render broken. ' +
        'Propose Jira changes only through propose_jira_update or record_code_review and never claim a write happened. ' +
        (config.assistant.extraInstructions
          ? `Additional project guidance: ${config.assistant.extraInstructions} `
          : ''),
    },
    ...formattedHistory,
  ];

  const aiBaseUrl = config.assistant.baseUrl;
  const apiKey = requireApiKey();
  const candidates = await getModelCandidates(aiBaseUrl, apiKey);
  const usedModels = new Set();
  let model = await resolveModel(aiBaseUrl, apiKey);

  async function callModelWithFailover(messages) {
    for (let attempt = 0; attempt < candidates.length + 1; attempt += 1) {
      try {
        return await callModel(messages, model);
      } catch (error) {
        const unsupportedModel = isUnsupportedModelError(error);
        if (!isRateLimitError(error) && !unsupportedModel) throw error;
        if (!unsupportedModel) {
          const wait = rateLimitWaitSeconds(error) * 1000;
          await sleep(attempt === 0 ? Math.min(wait, 2500) : wait);
        }
        usedModels.add(model);
        const next = pickModel(candidates, usedModels);
        if (!next) {
          throw new Error(
            unsupportedModel
              ? 'No chat-capable AI model is available for the configured provider. Check the AI_MODEL and AI_BASE_URL settings.'
              : 'The AI provider is rate-limited on every available free model right now. Please wait a few seconds and ask again.',
          );
        }
        model = next;
        lastSelectedModel = next;
      }
    }
    throw new Error(
      'The AI provider is rate-limited on every available free model right now. Please wait a few seconds and ask again.',
    );
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const result = await callModelWithFailover(conversation);
    const message = result.choices?.[0]?.message;
    if (!message) throw new Error('AI provider returned an empty response.');

    conversation.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      const chatMessages = conversation
        .filter((item) => (item.role === 'user' || item.role === 'assistant') && item.content)
        .map((item) => ({ role: item.role, content: item.content }));

      return { message: message.content ?? '', messages: chatMessages };
    }

    for (const toolCall of message.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        args = {};
      }

      // Clean tool call name in case LLM appends prompt injection strings
      const toolName = toolCall.function.name.split('<')[0].split('|')[0].trim();
      const output = await runTool(toolName, args, bundle);

      if (output.confirmation_required) {
        const chatMessages = conversation
          .filter((item) => (item.role === 'user' || item.role === 'assistant') && item.content)
          .map((item) => ({ role: item.role, content: item.content }));

        let message;
        if (output.action.type === 'review_comment') {
          const prRef = output.action.pr_number ? ` on PR #${output.action.pr_number}` : '';
          message = `I can record a code review on **${output.action.issueKey}**${prRef}: **${output.action.reviewer}** spent **${output.action.time_spent}** on code review. Adding this posts a comment on the Jira ticket. Please confirm below.`;
        } else {
          message = `I can update ticket **${output.action.issueKey}**: set **${output.action.field}** to **${JSON.stringify(output.action.value)}**. Please confirm below.`;
        }
        return {
          message,
          confirmation: output.action,
          messages: chatMessages,
        };
      }

      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(output),
      });
    }
  }

  throw new Error('The assistant reached its tool-call limit. Try asking a more specific question.');
}

export async function applyAssistantUpdate(action, bundle, refresh) {
  if (!action?.issueKey) throw new Error('Invalid assistant update action.');

  // Review-comment action: posts "{reviewer} spent {time} on code review".
  if (action.type === 'review_comment') {
    if (!getConfig().features.reviewLogging) throw new Error('Code-review logging is disabled for this deployment.');
    const issueKey = assertIssueKey(action.issueKey);
    const reviewer = String(action.reviewer ?? '')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 80);
    const timeSpent = String(action.time_spent ?? '')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 40);
    if (!bundle.tickets?.[issueKey])
      throw new Error(`Ticket ${issueKey} is not present in the current dashboard data.`);
    if (!reviewer || !timeSpent)
      throw new Error('Invalid review comment action: reviewer and time_spent are required.');
    const comment = formatReviewComment(reviewer, timeSpent);
    await postJiraComment(issueKey, comment);
    if (refresh) await refresh();
    return { issueKey, type: 'review_comment', comment };
  }

  const issueKey = assertIssueKey(action.issueKey);
  if (!EDITABLE_FIELDS.has(action.field)) throw new Error('Invalid assistant update action.');
  if (!bundle.tickets?.[issueKey]) throw new Error(`Ticket ${issueKey} is not present in the current dashboard data.`);

  await updateJiraIssueField(issueKey, action.field, action.value);
  if (refresh) await refresh();

  return { issueKey, field: action.field, value: action.value };
}
