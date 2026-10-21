# Troubleshooting

Start with `npm run check` — it validates `.env` and tests both APIs, and its
messages point at the variable to fix.

| Symptom                                                            | Cause / fix                                                                                                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Invalid configuration: - JIRA_… is required`                      | `.env` missing or incomplete. `cp .env.example .env` and fill in the Jira block. On Vercel, add the variables in Project → Settings.                                                  |
| `Jira API 401 verifying Jira credentials`                          | Wrong email/token pair, or the token was revoked. Tokens are per Atlassian account — the email must be that account's.                                                                |
| `Jira API 404 fetching versions for project ABC`                   | `JIRA_PROJECT_KEY` is wrong or the account can't Browse the project.                                                                                                                  |
| `JIRA_STORY_POINTS_FIELD … does not exist on this Jira site`       | Run `npm run jira:fields` and copy the id shown.                                                                                                                                      |
| Dashboard loads but every SP is blank                              | Wrong story-points field id (several fields are often named "Story Points"). Check with `npm run jira:fields` and a known ticket.                                                     |
| AI % shows 4000% or 0.4%                                           | `JIRA_AI_CONTRIBUTION_SCALE` is wrong for your field.                                                                                                                                 |
| "No releases found"                                                | The project has no versions, or all are archived/older than the lookback. Create a version in Jira or set `JIRA_RELEASES`.                                                            |
| A release shows "not found in Jira"                                | A name in `JIRA_RELEASES` / `?releases=` doesn't match a version name exactly (names are case-sensitive).                                                                             |
| Cycle time is blank for every ticket                               | `JIRA_IN_PROGRESS_STATUSES` / `JIRA_CODE_REVIEW_STATUSES` don't match your workflow's status names.                                                                                   |
| `GitHub API 401 … Bad credentials`                                 | Token invalid/expired. Fine-grained tokens expire; org tokens may await admin approval.                                                                                               |
| `GitHub API 404` for a repository                                  | Token lacks access to that repo, or `GITHUB_REPOS` has a typo. Private repos need explicit repository access on fine-grained tokens.                                                  |
| "GitHub: could not sync …" banner on the dashboard                 | One repository failed; the rest of the dashboard still rendered. Details are in the server log.                                                                                       |
| "No linked PR found" on tickets that have PRs                      | The PR title/body doesn't follow a recognised convention (see GITHUB_SETUP.md), the PR is older than `GITHUB_LOOKBACK_DAYS`, or it targets a branch excluded by `GITHUB_BASE_BRANCH`. |
| Review timings are blank on old PRs                                | They were cached before the metric existed. `npm run cache:clear` then refresh.                                                                                                       |
| Inline edit fails with `No Jira transition to "X" is available`    | Jira's workflow doesn't allow that status from the current one; the error lists what is allowed.                                                                                      |
| Inline edit fails with `Field "…" cannot be edited`                | Only SP/AP/AI %/summary/status/assignee/issue type are editable by design.                                                                                                            |
| `/api/tickets/...` returns 403                                     | `JIRA_EDITING_ENABLED=false` on this deployment.                                                                                                                                      |
| Vercel returns 503 `Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD` | Basic Auth is mandatory on Vercel. Add both variables and redeploy.                                                                                                                   |
| Vercel: `BLOB_READ_WRITE_TOKEN is not set`                         | Create a **private** Blob store in the Vercel project (Storage tab) and connect it; the token is injected automatically.                                                              |
| Vercel cron never refreshes                                        | `CRON_SECRET` unset or differs from the project setting. Hobby plans allow one daily run (see `vercel.json`).                                                                         |
| Refresh button is slow or says "timed out"                         | The button streams the current Jira/GitHub fetch step while refreshing. Cold Vercel instances may need to fetch Jira histories and PR activity again because working caches are temporary. Requests run in bounded batches, and the button allows up to 280 s below the configured 300 s function limit. If it remains slow, reduce `GITHUB_LOOKBACK_DAYS` / configured repositories and check Vercel function logs for API errors or platform timeouts. |
| `Port 3000 is already in use; trying 3001`                         | Informational. Set `PORT` to pin a port.                                                                                                                                              |
| Assistant button missing                                           | `AI_API_KEY` unset — the assistant is optional.                                                                                                                                       |
| Assistant: `No chat-capable AI model is available`                 | `AI_MODEL` doesn't exist at `AI_BASE_URL` or doesn't support tool calling.                                                                                                            |
| Tests fail with `Unexpected fetch in test`                         | A test hit the network. All external calls must be mocked with `mockFetch` from `test/helpers/config.js`.                                                                             |

## Resetting state

| What                        | Command / location                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------- |
| GitHub + Jira working cache | `npm run cache:clear`                                                                 |
| Generated output            | `rm -rf data/output`                                                                  |
| Review-time logs (local)    | `data/cache/review-logs.json` (Vercel: Blob `dev-metrics-dashboard/review-logs.json`) |
| Vercel snapshot             | Blob `dev-metrics-dashboard/dashboard-bundle.json`; the next refresh replaces it      |

## Getting more detail

- The local server logs every fetch stage with a `[dev-metrics]` prefix.
- `curl localhost:3000/health` shows the last generation time and last error.
- `data/output/bundle.json` (after `npm run generate`) is the exact data the page renders.
