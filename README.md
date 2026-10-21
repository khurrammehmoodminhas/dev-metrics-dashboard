# Dev Metrics Dashboard

A self-hosted engineering delivery dashboard for teams that plan in **Jira**
and ship through **GitHub**. It answers, per release: what was planned, what
was delivered, by whom, how long work took to reach review, and how much AI
assistance was involved — with the pull requests as evidence.

It is a visibility tool, not a performance-evaluation system: there is no
score, no ranking and no "at risk" label.

- **Docs:** [Configuration](docs/CONFIGURATION.md) · [Architecture](docs/ARCHITECTURE.md) · [Metrics](docs/METRICS.md) · [Jira setup](docs/JIRA_SETUP.md) · [GitHub setup](docs/GITHUB_SETUP.md) · [AI contribution](docs/AI_CONTRIBUTION.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Security](docs/SECURITY.md) · [Changes & roadmap](docs/CHANGES.md)

## What is Dev Metrics?

A Node.js application that:

1. reads releases (versions) and tickets from a Jira project,
2. reads pull requests, reviews and commits from one or more GitHub repositories,
3. links PRs to tickets by key,
4. renders one self-contained HTML page where every chart recalculates in the
   browser as you select releases, developers and filters.

It runs locally with one command, or on Vercel with a daily refresh.

## Why does it exist?

Engineering managers were maintaining release spreadsheets by hand: story
points, actual points, AI usage, links to PRs. The numbers already lived in
Jira and GitHub. This tool reads them directly, keeps a single definition for
each metric ([docs/METRICS.md](docs/METRICS.md)), and shows the supporting
evidence next to every number.

## Features

| Area                 | What you get                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Releases             | Released / current / upcoming versions discovered from Jira; pick any combination; deep-linkable (`?releases=`)                                                                                       |
| Story points         | Planned SP vs delivered AP per release, per developer, per issue type; cumulative progress over time                                                                                                  |
| Tickets              | Every ticket in the selection with status, assignee, points, AI %, linked PRs; filter, sort, inline edit                                                                                              |
| Code review          | Time to first review, approval and review completion per PR (from GitHub); manual "log review time" → Jira comment                                                                                    |
| Cycle time           | In Progress → Code Review median/mean, histogram, tickets currently aging                                                                                                                             |
| AI contribution      | Ticket-level AI % from Jira; PR-level checklist score and AI co-authored commit share as evidence                                                                                                     |
| Activity             | PRs opened/merged and tickets started/completed per day; stale-PR list; per-developer timeline                                                                                                        |
| Jira write-back      | Edit SP/AP/AI %/status/assignee/summary/issue type from the table (allowlisted, validated, fails loudly)                                                                                              |
| Assistant (optional) | Ask questions in plain language over the dashboard data; proposes Jira edits that you confirm. Sends ticket data to the LLM provider — see [Security](docs/SECURITY.md#data-leaving-the-organisation) |

Every feature that depends on something you haven't configured (GitHub, actual
points, AI tracking, assistant, editing) is hidden rather than shown empty.

## Architecture

```
Jira (REST v3) ─┐                                   ┌─ browser computes all metrics
                ├─► generateDashboard() ─► bundle ──┤   (deliveryMath.js / timeSeries.js)
GitHub (REST) ──┘        src/index.js       JSON    └─ self-contained dashboard.html
```

- No framework, no build step, one runtime dependency (`@vercel/blob`, Vercel only).
- All configuration is environment variables; nothing project-specific in code.
- Two transports share one implementation: `src/server.js` (local) and
  `api/*.js` (Vercel) both call `src/http/handlers.js`.

Full description: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Supported integrations

| Integration                          | Required    | Protocol                              | Notes                                            |
| ------------------------------------ | ----------- | ------------------------------------- | ------------------------------------------------ |
| Jira Cloud                           | Yes         | REST API v3, API token (Basic auth)   | Read tickets/versions/changelog; optional writes |
| GitHub (github.com)                  | No          | REST API, personal access token       | Read-only: PRs, reviews, comments, commits       |
| OpenAI-compatible LLM (Groq default) | No          | `/chat/completions` with tool calling | Powers the assistant panel only                  |
| Vercel Blob                          | Vercel only | `@vercel/blob`                        | Durable snapshot + review logs on serverless     |

**No MCP servers are used or required.** The repository may be developed with
Claude Code and the Arbisoft workflow skills (which use Atlassian/GitHub MCPs
for the developer's own workflow), but the application itself talks to Jira
and GitHub directly. Jira Server/Data Center and GitHub Enterprise are not
supported without changing the base URLs in `src/fetch/*` (see roadmap).

## Requirements

- Node.js **20 or newer** (uses `node --test`, `--env-file-if-exists`, global `fetch`).
- A Jira Cloud account with an API token ([docs/JIRA_SETUP.md](docs/JIRA_SETUP.md)).
- Optionally a GitHub token ([docs/GITHUB_SETUP.md](docs/GITHUB_SETUP.md)).

## Installation

```bash
git clone <this repository>
cd dev-metrics-dashboard
npm install
cp .env.example .env
```

## Configuration

Edit `.env`. The minimum for a first run:

```bash
PROJECT_NAME=My Project
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=you@your-org.com
JIRA_API_TOKEN=...
JIRA_PROJECT_KEY=ABC
JIRA_STORY_POINTS_FIELD=customfield_10016   # npm run jira:fields tells you which
```

Then verify everything against the live APIs:

```bash
npm run check
```

Every variable, its default and its effect: [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Jira setup

1. Create an API token at id.atlassian.com → Security.
2. Make sure the account can browse the project (plus edit/transition/comment
   if you want write features).
3. `npm run jira:fields` → copy the custom field ids for story points and,
   if your team uses them, actual points and AI contribution.
4. Map your workflow's status names if they aren't `In Progress` / `Code Review`.
5. Tickets must carry a **fixVersion** — the dashboard is organised by version.

Details and required permissions: [docs/JIRA_SETUP.md](docs/JIRA_SETUP.md).

## GitHub setup

1. Create a fine-grained token with **Pull requests: Read** and **Contents: Read**
   on the repositories you want.
2. `GITHUB_REPOS=org/repo-a,org/repo-b`, `GITHUB_TOKEN=...`.
3. Name PRs `ABC-123: …` (or `[ABC-123] …`, `feat(ABC-123): …`) so they link to tickets.

Details: [docs/GITHUB_SETUP.md](docs/GITHUB_SETUP.md).

## AI contribution setup

Three optional sources: a numeric Jira field on the ticket, an
`AI Contribution Checklist` table in the PR description, and
`Co-Authored-By:` commit trailers from coding assistants. Configure any subset
or turn the feature off with `AI_CONTRIBUTION_ENABLED=false`.

Details and the PR template snippet: [docs/AI_CONTRIBUTION.md](docs/AI_CONTRIBUTION.md).

## Local development

```bash
npm run dev          # server on http://localhost:3000, restarts on file changes
npm start            # same without the file watcher
npm run generate     # one-off: writes data/output/dashboard.html + bundle.json
npm run generate -- --releases "1.2.0,1.3.0"   # explicit releases for this run
```

The local server regenerates every 60 seconds and on the **Refresh** button.
`?releases=1.2.0` in the URL pre-selects releases. `curl localhost:3000/health`
shows the last generation time and error.

Data lives under `data/` (gitignored): `cache/` (GitHub PRs, Jira changelogs,
review logs) and `output/`.

## Testing

```bash
npm test             # node:test, ~130 tests, no network, no credentials needed
npm run test:watch
```

External APIs are mocked by replacing `globalThis.fetch`
(`test/helpers/config.js` → `mockFetch`). Metric functions are tested by
running the exact browser source in Node.

## Build

There is no compile step. `npm run build` runs lint + tests and then generates
the static dashboard into `data/output/`:

```bash
npm run lint         # eslint
npm run lint:fix
npm run format       # prettier --write
npm run format:check
npm run build        # lint + test + generate
```

## Deployment

### Vercel (recommended)

1. Import the repository as an **Other** framework project (no build command,
   no output directory). `vercel.json` defines the routes and a daily cron.
2. Add the environment variables from `.env` **plus**:
   - `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — HTTP Basic Auth for the whole site (mandatory),
   - `CRON_SECRET` — any random string (`openssl rand -hex 32`),
   - a **private Vercel Blob store** connected to the project (provides `BLOB_READ_WRITE_TOKEN`).
3. Deploy. The first page load generates the snapshot; the cron refreshes it
   daily (Hobby plan limit) and the Refresh button on demand.

### Self-hosted

Run `npm start` under a process manager behind a reverse proxy that adds
authentication (or set `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`, which the
local server also enforces). The server listens on `127.0.0.1` by default; set
`HOST=0.0.0.0` when the proxy runs on another host. Set `DATA_DIR` to a
persistent volume.

## Troubleshooting

Run `npm run check` first. Common issues and fixes:
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Adding a new project

Onboarding checklist for a team receiving this repository:

| You need                     | Where it goes                                                       |
| ---------------------------- | ------------------------------------------------------------------- |
| Project name                 | `PROJECT_NAME`                                                      |
| Jira URL                     | `JIRA_BASE_URL`                                                     |
| Jira project key             | `JIRA_PROJECT_KEY`                                                  |
| Jira email + API token       | `JIRA_EMAIL`, `JIRA_API_TOKEN`                                      |
| Story points field id        | `JIRA_STORY_POINTS_FIELD` (`npm run jira:fields`)                   |
| Actual points / AI field ids | `JIRA_ACTUAL_POINTS_FIELD`, `JIRA_AI_CONTRIBUTION_FIELD` (optional) |
| Workflow status names        | `JIRA_IN_PROGRESS_STATUSES`, `JIRA_CODE_REVIEW_STATUSES`            |
| GitHub org/repos + token     | `GITHUB_REPOS`, `GITHUB_TOKEN` (optional)                           |
| Default branch filter        | `GITHUB_BASE_BRANCH` (optional)                                     |
| AI contribution on/off       | `AI_CONTRIBUTION_ENABLED`                                           |

Jira boards are not needed — the tool works from versions. Then:

```bash
npm install && cp .env.example .env   # fill in the table above
npm run check                          # validates config, verifies credentials
npm run dev                            # open http://localhost:3000
```

Teams that plan by sprint instead of by version: see "Future improvements" in
[docs/CHANGES.md](docs/CHANGES.md); today, create a version per sprint or set
fixVersions on sprint tickets.

## Adding a new metric

1. Write a pure function in `src/dashboard/client/deliveryMath.js`
   (snapshot rollups) or `timeSeries.js` (time-bucketed), taking the visible
   tickets as input.
2. Export it from the matching `*Node.js` wrapper and add a test under
   `test/dashboard/client/`.
3. Add a `render<Name>()` in `src/dashboard/client/picker.js`, call it from
   `renderAll()`, and add the section container in `src/dashboard/render.js`.
4. If it needs a new field: add it in `src/normalize/ticketRecord.js`
   (tickets) or `buildPrRecord()` in `src/index.js` (PRs).
5. Define it in [docs/METRICS.md](docs/METRICS.md).

Other extension points (new Jira field, new integration, new write action):
[docs/ARCHITECTURE.md → Extension points](docs/ARCHITECTURE.md#extension-points).

## Contributing

- Branch from `main`; keep PRs focused. Run `npm run build` before opening one.
- Metric changes must update `docs/METRICS.md` and the tests next to the code.
- Never commit `.env` or real ticket data; test fixtures use fictional keys.
- Anything that writes to Jira must validate the issue key, use the field
  allowlist and return the upstream error verbatim.
- Configuration goes in `src/config/index.js` + `.env.example` +
  `docs/CONFIGURATION.md`, never in code constants.
