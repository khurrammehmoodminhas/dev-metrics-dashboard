# Productization changes, technical debt and roadmap

This document accompanies the `feat/productize-for-arbisoft-reuse` branch. It
lists what changed to turn the original single-project dashboard into a reusable
internal tool, what was deliberately left as is, and what should come next.

## Major changes

### Configuration

- **New `src/config/index.js`** — every setting is an environment variable,
  validated on first use with all problems reported together. Replaces
  `config/config.js`, which hard-coded one team's repositories,
  project key, Jira site, three custom field ids and a
  top-level `await` that hit the Jira API at import time.
- Feature flags derived from configuration (`github`, `actualPoints`,
  `aiContribution`, `assistant`, `jiraEditing`, `reviewLogging`) drive both
  the UI and the API, so a project can run Jira-only, read-only, or without AI
  tracking.
- `publicConfig()` is the only path from config to the browser.
- New `.env.example` with every variable documented; `docs/CONFIGURATION.md`
  is the reference.

### Jira

- JQL is scoped to `project = KEY` (previously any project on the site with a
  matching version name would leak in).
- Release discovery moved to `src/fetch/jiraVersions.js`, runs per generation
  (not at import), returns full release records with `state`
  (released / active / upcoming / unknown), and **fails loudly** instead of
  silently returning an empty list.
- Shared `jiraClient.js` (auth, errors, issue-key validation) replaces three
  copies of the auth-header code; the assistant's `fetch_live_jira_issue`
  previously used an undefined `JIRA_HOST` variable and REST v2.
- Field writes restricted to an allowlist with validation (security fix);
  status names for cycle time are configurable; AI field scale is configurable.
- Optional `JIRA_ISSUE_TYPES` filter and `JIRA_RELEASES` allowlist.

### GitHub

- Repositories, lookback, stale threshold and optional base-branch filter from
  configuration. GitHub is optional.
- **Review timing metrics are now actually computed** (`src/parse/prReviews.js`):
  reviewers, time to first review, time to approval, review completion. The
  previous code fetched reviews/comments for every PR and then discarded them,
  while the UI already had columns for these values (always empty).
- PR author login recorded; ticket-id extraction supports more title/body
  conventions and ignores keys from other projects.
- Per-repository failures are reported in a warnings banner instead of
  aborting the whole run.

### AI contribution

- Checklist heading and co-author tool names configurable
  (`AI_CHECKLIST_HEADING`, `AI_COAUTHOR_PATTERNS`); trailer matching now finds
  the tool name anywhere on the line (e.g. "GitHub Copilot").
- Whole feature can be disabled.

### Assistant

- All project-specific aliases, repository names and prompt text removed;
  repositories and vocabulary derive from config, with
  `ASSISTANT_EXTRA_INSTRUCTIONS` for team guidance.
- Fixed `compactTicket`/`search_prs` reading non-existent PR fields
  (`pr.title`, `pr.number` instead of `pr_title`, `pr_number`) and removed ~80
  lines of speculative fallbacks over bundle keys that never existed.
- Disabled cleanly when `AI_API_KEY` is unset (button and script not rendered,
  API returns 403).

### HTTP layer

- `src/http/{body,respond,handlers}.js` — transport-agnostic handlers shared
  by `src/server.js` and the Vercel functions; removed the duplicated route
  logic, body readers and `escapeHtml` copies.
- Ticket updates report partial application (`appliedFields` / `failedField`);
  a post-write refresh failure no longer masquerades as a failed edit.
- Readable error page and JSON 503 on configuration errors; 404 for unknown
  routes; `/api/health` locally.

### UI

- Project name in title/header; releases grouped into "Current & upcoming" /
  "Released" with dates and Select all / Clear; warnings banner; empty states
  for "no releases" and "no releases selected"; columns/sections hidden per
  feature flag.

### Repository hygiene

- Removed `.playwright-mcp/` snapshots (1.8 MB of real page dumps), dead
  `src/dashboard/client/inlineEdit.js` (duplicated in `picker.js`, only a test
  imported it), and `config/config.js`.
- ESLint (flat config) + Prettier added; `npm run lint`, `format`, `build`,
  `check`, `jira:fields`, `cache:clear`, `dev` (watch mode).
- Tests: 76 → 127, now covering config validation, Jira/GitHub clients with a
  mocked `fetch`, release discovery, review timing, HTTP handlers (including
  partial failure and disabled features), render output and XSS escaping. No
  test touches the network.
- Documentation set under `docs/` and a rewritten README.

### Pre-release hardening

- **XSS:** the bundle JSON escape replaced `<` with itself, so a ticket
  summary containing `</script>` could run script on the dashboard. Fixed and
  the test now checks the whole page.
- **CSRF:** write endpoints require a same-origin `application/json` request.
- **Local server:** binds to `127.0.0.1` (`HOST`) and enforces Basic Auth when
  credentials are set.
- Ticket edits are limited to `JIRA_PROJECT_KEY`; the assistant's review
  comment honours `REVIEW_LOGGING_ENABLED`; assistant links are http(s) only;
  `JIRA_BASE_URL` must be https.
- Section numbers follow the visible sections (no gap when GitHub is off); the
  activity trend hides PR lines without GitHub; release progress starts at the
  first activity instead of the oldest backlog ticket.
- `package-lock.json` is committed, CI runs lint + tests, `.nvmrc` pins Node 20.
- Test fixtures use fictional names and keys only.

## Behaviour changes to be aware of

| Change                                                                         | Impact on the original deployment                                                                                            |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Configuration moved to env vars                                                | Add `JIRA_PROJECT_KEY`, `GITHUB_REPOS`, the three `JIRA_*_FIELD` ids and `PROJECT_NAME` to Vercel. `npm run check` confirms. |
| JQL scoped to project                                                          | None expected (versions already belonged to the project).                                                                    |
| Ticket-id extraction accepts more conventions and rejects other projects' keys | Possibly a few more PRs linked; none lost.                                                                                   |
| Review timings computed                                                        | Cached PRs show `null` until they change or `npm run cache:clear` runs.                                                      |
| `npm start` now runs the server (was: generate static file)                    | Use `npm run generate` for the static file.                                                                                  |
| Release picker ordering                                                        | Active first, then upcoming, then released newest-first.                                                                     |

No metric definition was changed. Two ambiguities are documented in
METRICS.md rather than changed: "Delivered AP" includes AP on unfinished
tickets, and "current release" is a selection rather than a computed notion.

## Remaining technical debt

1. **`picker.js` (~1.3k lines) builds HTML by string concatenation** with
   module-level state. It works and is tested indirectly, but adding a section
   means editing several functions. A small view layer (or templating per
   section) would help; not done here to avoid a rewrite.
2. **Client scripts are shared with Node via `vm.runInThisContext`** — a
   pragmatic trick to keep browser and Node running identical code with no
   build step. If a bundler is ever introduced, replace with ESM imports.
3. **No per-user identity.** Basic Auth is a single shared credential; Jira
   edits are attributed to the service account. SSO in front of the deployment
   is the recommended fix.
4. **Blob paths are fixed** (`dev-metrics-dashboard/…`), so one Blob store
   serves one project. Fine for one-deployment-per-project; a `BLOB_PREFIX`
   would be needed to share a store.
5. **Vercel `/tmp` cache is per warm instance**, so a cold function refetches
   the GitHub window. Acceptable at daily cron cadence; a persisted cache (Blob)
   would make refreshes faster on large repositories.
6. **Refresh is synchronous** (120 s timeout on Vercel). Large first runs
   should be done locally or split; a background job would be better.
7. **Assistant model list is Groq-specific** in `FALLBACK_MODELS`. It only
   matters for failover; with another provider set `AI_MODEL` explicitly.
8. **No end-to-end browser test**; UI behaviour is verified by the render test
   (valid inline scripts, escaping) and by manual runs. A Playwright smoke
   test would catch DOM regressions.
9. `scripts/validateAgainstSheet.js` encodes one team's Google Sheet column
   names; kept as a worked example of validating the tool against a manual
   source.
10. `package-lock.json` is gitignored (inherited). Committing it would make
    installs reproducible across teams; left unchanged here to keep this
    branch focused.

## Future improvements

- Sprint/board mode for teams that don't plan by fixVersion (JQL by
  `sprint in openSprints()` with the same bundle shape).
- Persist the GitHub cache in Blob on Vercel; background refresh with
  progress.
- Audit log of dashboard writes; SSO integration.
- CSV/JSON export of the current selection.
- Optional GitHub-login ↔ Jira-account mapping (config file) to attribute PR
  authorship, kept opt-in so the "assignee is the developer" rule stays the
  default.
- Trend of AI contribution across releases.
- Multi-project support in one deployment (config namespaced by project key).
