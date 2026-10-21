# Configuration reference

All configuration is read from environment variables (locally from `.env`, on
Vercel from the project's Environment Variables). There is no configuration in
code. The loader lives in [`src/config/index.js`](../src/config/index.js); it
validates every variable on first use and fails with a list of every problem
at once.

Run `npm run check` after editing `.env` — it validates the values and verifies
the Jira and GitHub credentials against the live APIs.

## Project

| Variable       | Required | Description                                                                 | Example         |
| -------------- | -------- | --------------------------------------------------------------------------- | --------------- |
| `PROJECT_NAME` | No       | Display name in the header and page title. Default: `Engineering Delivery`. | `Acme Platform` |

## Jira

| Variable                       | Required | Description                                                                                                                                | Example                      |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `JIRA_BASE_URL`                | **Yes**  | Jira Cloud site URL (no trailing path).                                                                                                    | `https://acme.atlassian.net` |
| `JIRA_EMAIL`                   | **Yes**  | Atlassian account email the API token belongs to.                                                                                          | `metrics-bot@acme.com`       |
| `JIRA_API_TOKEN`               | **Yes**  | Atlassian API token. See [JIRA_SETUP.md](JIRA_SETUP.md).                                                                                   | `ATATT3x...`                 |
| `JIRA_PROJECT_KEY`             | **Yes**  | Project key (the `ABC` in `ABC-123`). Scopes every JQL query and release discovery; PRs referencing other projects' keys are ignored.      | `ABC`                        |
| `JIRA_STORY_POINTS_FIELD`      | **Yes**  | Custom field id holding planned story points. Find it with `npm run jira:fields`.                                                          | `customfield_10016`          |
| `JIRA_ACTUAL_POINTS_FIELD`     | No       | Custom field id holding delivered ("actual") points. Blank disables the AP metrics and columns.                                            | `customfield_10833`          |
| `JIRA_AI_CONTRIBUTION_FIELD`   | No       | Custom field id holding the ticket-level AI contribution. Blank means AI contribution comes only from PR signals (if enabled).             | `customfield_11729`          |
| `JIRA_AI_CONTRIBUTION_SCALE`   | No       | How that field stores its value: `fraction` (0–1, displayed ×100) or `percent` (0–100). Default `fraction`.                                | `percent`                    |
| `JIRA_IN_PROGRESS_STATUSES`    | No       | Comma-separated status names that mean "work started" for cycle time. Case-insensitive. Default `In Progress`.                             | `In Progress,Development`    |
| `JIRA_CODE_REVIEW_STATUSES`    | No       | Comma-separated status names that mean "in review" for cycle time. Default `Code Review`.                                                  | `Code Review,In Review`      |
| `JIRA_RELEASE_LOOKBACK_MONTHS` | No       | Auto-discovery keeps every unreleased version plus versions released within this many months. Default `6`.                                 | `3`                          |
| `JIRA_RELEASES`                | No       | Explicit comma-separated list of version names to track instead of auto-discovery. Names that don't exist are shown flagged in the picker. | `1.2.0,1.3.0`                |
| `DEFAULT_RELEASES`             | No       | Which tracked releases are pre-selected when the page opens. Default: all. `?releases=` in the URL overrides it.                           | `1.3.0`                      |
| `JIRA_ISSUE_TYPES`             | No       | Restrict tickets to these issue types. Default: all types.                                                                                 | `Story,Bug,Task`             |

Jira boards and sprints are **not** used: the tool is organised around
versions (fixVersions). If your team plans by sprint rather than by release,
see "Adding a new project" in the README.

## GitHub

| Variable                     | Required              | Description                                                                                                                 | Example             |
| ---------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `GITHUB_REPOS`               | No                    | Comma-separated `owner/name` list. Blank disables GitHub entirely (no PR evidence, no review metrics, no PR trend section). | `acme/web,acme/api` |
| `GITHUB_TOKEN`               | If `GITHUB_REPOS` set | Token with read access to those repositories. See [GITHUB_SETUP.md](GITHUB_SETUP.md).                                       | `github_pat_...`    |
| `GITHUB_BASE_BRANCH`         | No                    | Only count PRs whose base branch is this one. Blank = all PRs.                                                              | `main`              |
| `GITHUB_LOOKBACK_DAYS`       | No                    | On first run, fetch PRs updated within this many days. Bounds how far back ticket → PR evidence reaches. Default `90`.      | `180`               |
| `GITHUB_STALE_PR_AFTER_DAYS` | No                    | Open PRs older than this appear in the team-level "stale" list. Default `14`.                                               | `7`                 |

## AI contribution

| Variable                  | Required | Description                                                                                                                                        | Example           |
| ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `AI_CONTRIBUTION_ENABLED` | No       | `false` hides every AI metric and skips PR-body/commit parsing. Default `true`.                                                                    | `false`           |
| `AI_CHECKLIST_HEADING`    | No       | Heading text of the checklist table in PR descriptions. Default `AI Contribution Checklist`. See [AI_CONTRIBUTION.md](AI_CONTRIBUTION.md).         | `AI Usage Report` |
| `AI_COAUTHOR_PATTERNS`    | No       | Comma-separated names matched (case-insensitively) on `Co-Authored-By:` commit trailers. Default `claude,copilot,cursor,codex,gemini,devin,aider`. | `claude,copilot`  |

## Assistant (optional)

| Variable                       | Required | Description                                                                                     | Example                           |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------------------- | --------------------------------- |
| `AI_API_KEY`                   | No       | API key for an OpenAI-compatible chat-completions provider. Blank disables the assistant panel. | `gsk_...`                         |
| `AI_BASE_URL`                  | No       | Provider base URL. Default `https://api.groq.com/openai/v1`.                                    | `https://api.openai.com/v1`       |
| `AI_MODEL`                     | No       | Model name. **Must support tool calling.** Default `openai/gpt-oss-120b`.                       | `gpt-4o-mini`                     |
| `ASSISTANT_EXTRA_INSTRUCTIONS` | No       | Free text appended to the assistant's system prompt (team vocabulary, naming conventions...).   | `"Releases are named by sprint."` |

## Write features

| Variable                  | Required | Description                                                                                             | Example                           |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `JIRA_EDITING_ENABLED`    | No       | Inline editing of ticket fields from the dashboard. `false` makes the tool read-only. Default `true`.   | `false`                           |
| `REVIEW_LOGGING_ENABLED`  | No       | "Log code review time" (posts a Jira comment). Default `true`.                                          | `false`                           |
| `REVIEW_COMMENT_TEMPLATE` | No       | Comment text; must contain `{reviewer}` and `{time}`. Default `{reviewer} spent {time} on code review`. | `Code review: {reviewer}, {time}` |

## Server and deployment

| Variable                | Required      | Description                                                                                           | Example                |
| ----------------------- | ------------- | ----------------------------------------------------------------------------------------------------- | ---------------------- |
| `PORT`                  | No            | Local server port. Default `3000` (falls over to the next port if busy).                              | `8080`                 |
| `HOST`                  | No            | Interface the local server listens on. Default `127.0.0.1`; use `0.0.0.0` only behind authentication. | `0.0.0.0`              |
| `DATA_DIR`              | No            | Directory for the working cache and generated output. Default `./data` (or `/tmp` on Vercel).         | `/var/lib/metrics`     |
| `DASHBOARD_USERNAME`    | On Vercel     | HTTP Basic Auth username protecting every route. Optional locally. Must be set with the password.     | `team`                 |
| `DASHBOARD_PASSWORD`    | On Vercel     | HTTP Basic Auth password.                                                                             | `a-long-random-string` |
| `CRON_SECRET`           | On Vercel     | Bearer secret Vercel Cron sends to `/api/refresh`.                                                    | `openssl rand -hex 32` |
| `BLOB_READ_WRITE_TOKEN` | On Vercel     | Token of a **private** Vercel Blob store holding the dashboard snapshot and review logs.              | `vercel_blob_rw_...`   |
| `VERCEL`                | Set by Vercel | Presence switches the cache to `/tmp` and makes Basic Auth mandatory. Don't set it yourself.          | —                      |
| `REVIEW_LOGS_FILE`      | No (tests)    | Overrides the local review-log file path. Used by the test suite.                                     | —                      |

## Feature flags derived from configuration

The browser receives these (never any secret) as `features` in the bundle and
hides what a project hasn't configured:

| Flag             | True when                                      | Effect when false                                         |
| ---------------- | ---------------------------------------------- | --------------------------------------------------------- |
| `github`         | `GITHUB_REPOS` non-empty                       | PR columns, PR trend and PR series hidden                 |
| `actualPoints`   | `JIRA_ACTUAL_POINTS_FIELD` set                 | AP tiles/columns hidden; developers sorted by planned SP  |
| `aiContribution` | `AI_CONTRIBUTION_ENABLED=true`                 | AI tiles/columns hidden; PR bodies/commits not parsed     |
| `jiraAiField`    | above **and** `JIRA_AI_CONTRIBUTION_FIELD` set | Ticket-level AI % always blank                            |
| `assistant`      | `AI_API_KEY` set                               | "Ask assistant" button and script not rendered; API → 403 |
| `jiraEditing`    | `JIRA_EDITING_ENABLED=true`                    | Cells not editable; `/api/tickets/*` → 403                |
| `reviewLogging`  | `REVIEW_LOGGING_ENABLED=true`                  | Code Review column hidden; `/api/reviews` → 403           |
