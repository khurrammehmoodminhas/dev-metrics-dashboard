# Engineering Delivery & AI Insights Dashboard

Replaces a manually-maintained Google Sheet with a tool that pulls delivery data
directly from Jira (Story Points, Actual Points, AI Contribution Percentage —
all native Jira fields already in use) and generates a self-contained,
interactive HTML dashboard organized around:

> **Release → Ticket → Developer → SP (planned) → AP (delivered) → AI Contribution → Linked PR(s) as evidence**

This is a transparent delivery-visibility tool, not an automated performance
evaluation system: there is no composite score, no On Track/Watch/At Risk
label, and no ranking. It surfaces what was planned, what was delivered, how
that was distributed across the team, and how AI was involved — GitHub PRs
appear only as supporting evidence linked to each ticket.

## Setup

```bash
cp .env.example .env
# fill in GITHUB_TOKEN, JIRA_EMAIL, JIRA_API_TOKEN in .env
```

- `GITHUB_TOKEN`: a GitHub personal access token with read access to the repos
  in `config/config.js` (used only to find PRs as evidence for Jira tickets).
- `JIRA_EMAIL` / `JIRA_API_TOKEN`: a Jira Cloud API token
  (id.atlassian.com → Security → API tokens) for `JIRA_BASE_URL`
  (defaults to `https://arbisoft.atlassian.net`).
- `AI_API_KEY`: an API key for the configured OpenAI-compatible provider. Groq's
  developer tier is the default low-cost/free option. The assistant sends questions to the model, while Jira/GitHub facts are
  retrieved through server-side tools from the dashboard bundle.
- `AI_BASE_URL`: optional provider base URL (defaults to Groq's
  `https://api.groq.com/openai/v1`).
- `AI_MODEL`: optional model name (defaults to
  `llama-3.1-8b-instant`).

Requires Node.js 20+.

## Usage

```bash
npm start                                # generate the dashboard for config.releasesToTrack
npm start -- --releases "8.5.0,8.6.0"    # override which releases to include in this run
npm run live                              # run the live server
DEFAULT_RELEASES="8.5.1 (Subscription),8.6.0" npm run live
```

## Deploying to Vercel

This repository includes Vercel serverless routes, so deploy the repository as
an **Other** framework project — no build command or output directory is
needed. Set these environment variables in the Vercel project settings:

- `GITHUB_TOKEN`, `JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN`
- `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` (required on Vercel; the site
  uses HTTP Basic Auth to protect both the dashboard and Jira update API)
- `CRON_SECRET` (a random secret used by Vercel Cron)
- `BLOB_READ_WRITE_TOKEN` from a **private** Vercel Blob store connected to the
  project
- optional: `DEFAULT_RELEASES`

The deployment serves the dashboard at `/`, accepts the existing
`?releases=` query parameters, and retains inline Jira editing at
`/api/tickets/:issueKey`. A protected Vercel Cron route refreshes the saved
dashboard bundle daily; page loads serve the last successful snapshot
immediately. The visible **Refresh dashboard** button and Jira edits refresh
that same snapshot on demand. This schedule works on Vercel Hobby, whose Cron
jobs are limited to daily runs. The low-level GitHub/Jira working cache remains
a best-effort `/tmp` optimization, while the displayed dashboard snapshot is
stored durably in private Blob storage.

The live dashboard also supports choosing the startup release selection via URL query parameters:

- Single release: `http://localhost:3000/?releases=8.6.0`
- Multiple releases: `http://localhost:3000/?releases=8.5.0,8.6.0`
- Multiple query params (equivalent): `http://localhost:3000/?releases=8.5.0&releases=8.6.0`

If both query params and `DEFAULT_RELEASES` are provided, the query params take precedence.

### Engineering data assistant

The dashboard includes a protected assistant panel powered by an
OpenAI-compatible model provider. It can
search the dashboard's Jira tickets and linked GitHub pull requests, calculate
release summaries, and answer questions about developers, story points, actual
points, statuses, and delivery evidence. It is constrained to the data tools
defined by the server, so answers can only use the current dashboard bundle.

The assistant can propose Jira edits for supported fields, but every edit is
shown in the dashboard and requires an explicit confirmation before the
existing Jira update path is called. GitHub data is read-only.

Output:
- `data/output/dashboard.html` — open this in a browser. The release picker,
  developer drill-down, sorting, and filtering all happen live in the page —
  no re-running the script needed to explore what's already in the file.
- `data/output/bundle.json` — the same `{releases, tickets}` data as JSON,
  useful for debugging.
- `data/cache/` — raw GitHub PR data and the last-fetched Jira ticket set,
  cached locally so re-runs only re-fetch GitHub PRs that changed. Jira
  tickets are always refetched in full on every run (SP/AP/AI% are actively
  edited throughout a release, so staleness matters more here than PR data).

## Configuration

Everything tunable lives in `config/config.js`:
- `repos`: GitHub repos to search for PR evidence.
- `releasesToTrack`: the Jira fixVersions a run includes by default (override
  per-run with `--releases`). Deliberately an explicit list, not
  auto-discovered — a stale list is easy to notice and fix.
- `jiraStoryPointsFieldId`, `jiraActualPointsFieldId`, `jiraAiContributionFieldId`:
  confirmed live against real tickets on this Jira instance, not guessed.
  **Note**: the AI Contribution field is stored in Jira as a 0–1 fraction —
  the tool multiplies by 100 for display; re-verify this if pointing at a
  different Jira instance.
- `lookbackDays`: how far back the GitHub PR cache reaches, which bounds how
  complete the ticket → PR evidence links can be.
- `stalePrAfterDays` (default 14): how long a PR must have been open to show up
  in the PR Activity Trend's stale list — a team-level, purely descriptive
  fact, never attributed to whoever opened it.

## How the dashboard works

Every section recomputes live in the browser as you change the release
selection — nothing is pre-aggregated server-side, because "% of highest AP,"
the activity trends, and the cycle-time distribution only mean something
relative to whichever release(s) are currently selected:

1. **Release Summary** — total tickets, completed/remaining, total planned SP,
   total delivered AP, team AI contribution (averaged only over tickets with a
   recorded value, with a coverage count shown alongside it).
2. **Release Progress Over Time** — cumulative delivered AP against a flat
   "total planned SP" reference line, and cumulative tickets completed, both
   by resolution date — shows whether delivery is steady or back-loaded.
3. **Ticket Status Breakdown** — current split of To Do / In Progress / Done.
4. **Issue Type Breakdown** — ticket count / planned SP / delivered AP faceted
   by issue type (Bug, Story, Task, etc.).
5. **Engineering Activity Trend** — per-day counts of PRs opened, PRs merged,
   tickets moving to In Progress, and tickets completed. Purely descriptive —
   not an "activity score."
6. **PR Activity Trend** — PRs opened/merged over time, how many are currently
   open, average open-PR age, and a team-level (never per-developer) list of
   PRs open longer than `stalePrAfterDays`.
7. **Delivery Flow: In Progress → Code Review** — mean and median hours from a
   ticket's first move into "In Progress" to its first subsequent move into
   "Code Review" (median shown alongside the mean, since averages mislead
   here), a fixed-bucket histogram of the distribution, and a list of tickets
   currently aging in "In Progress" with no Code Review transition yet.
8. **Developer Delivery** — one row per developer: tickets, planned SP,
   delivered AP, % of the highest AP delivered by anyone in the current
   selection, % of the team's total AP, and average AI contribution. Click a
   row to jump to that developer's tickets below.
9. **Developer Details** — the selected developer's own tickets (key linked to
   Jira, summary, status, SP, AP, AI contribution, linked PR(s) linked to
   GitHub — "No linked PR found" is neutral, never a negative signal), plus a
   personal activity timeline (tickets completed, PRs opened/merged over
   time) — never a comparison against anyone else.
10. **All Release Tickets** — every ticket in the selected release(s),
    filterable by developer/status/issue type and sortable by SP/AP/AI
    contribution.

Selecting multiple releases doesn't double-count a ticket that belongs to more
than one — the underlying dataset is a flat map keyed by ticket key, so
selecting several releases is just "tickets whose fixVersions intersect the
selection," and a ticket in two selected releases is still one ticket.

AP (Actual Points) and AI Contribution are pulled directly from Jira, not
derived from PRs — PRs are matched to tickets by ticket ID (parsed from the PR
title/body) purely to surface as supporting evidence, and they carry two of
their own signals for context: the self-reported AI Contribution Checklist
from the PR body, and the share of the PR's commits carrying a
"Co-Authored-By: Claude ..." trailer (structured, harder to game). Neither
feeds any Jira-level number or any score — there is no score.

### Cycle-time data (changelog)

The bulk Jira search endpoint doesn't return status-change history, so
cycle-time needs one extra API call per ticket
(`GET /rest/api/3/issue/{key}/changelog`). Unlike ticket fields (always
refetched in full — one cheap call regardless of ticket count), changelogs are
cached per ticket in `data/cache/jira/changelogs.json`, keyed by that ticket's
own Jira `updated` timestamp: a ticket's changelog is only refetched when
`updated` has changed since it was last cached. `updated` changes on *any*
field edit, not just a status transition, so this may occasionally refetch a
changelog that didn't actually change — but it will never skip a refetch that
was needed.

## Validating against the manual Google Sheet

```bash
node --env-file=.env scripts/validateAgainstSheet.js --csv <path-to-export.csv> --release "8.6.0"
```

Export the sheet's relevant tab as CSV, then run this to diff it against the
tool's own Jira-fetched data for that release: ticket count, assignees, SP
totals, AP totals, AI contribution (with a unit sanity check — warns if the
sheet's AI column looks like a 0–1 fraction instead of 0–100), developer-level
SP/AP, and release membership, all compared both directions. Add `--json` for
machine-readable output. This runs the *same* fetch/normalize code path the
dashboard itself uses, so a mismatch means real data disagreement, not two
independently-buggy implementations agreeing with each other.

## Known limitations

- **Ticket → PR evidence is only as complete as the GitHub PR cache's fetch
  window** (`lookbackDays`, default 90) — a ticket resolved via a PR merged
  long before that window won't show evidence here even though one exists on
  GitHub. This is treated as neutral ("no linked PR found"), never negative.
- **Developer identity is strictly the Jira assignee** — there's no mapping
  between a GitHub PR author and a Jira assignee, so a ticket's evidence PRs
  may have been authored by someone other than the ticket's assignee (e.g. a
  teammate picking up a PR). This is expected and not flagged as a discrepancy.
- **AP and AI Contribution reflect whatever is currently recorded in Jira** —
  if a ticket hasn't been updated with its actual points or AI contribution
  yet, those show as "not yet recorded" (blank), never estimated or assumed 0.
- **`releasesToTrack` is a manually maintained list** — add a new release to
  `config/config.js` (or pass `--releases`) when one starts.
- **Cycle-time uses the *first* "In Progress" → *first subsequent* "Code
  Review" transition** — tickets that cycle Code Review ↔ Internal QA
  (confirmed happening in real data) are handled correctly, but a ticket
  created directly into "In Progress" (skipping that transition entirely) has
  no recorded starting point, so it shows no cycle-time value — a disclosed
  gap, not an estimate.
- **Developer Activity Timeline's PR data comes from the developer's assigned
  tickets' linked PRs**, not GitHub PR authorship — consistent with the
  no-GitHub-login-mapping decision above.
