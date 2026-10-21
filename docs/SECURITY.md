# Security review

Scope: credentials, secrets handling, authentication/authorization, API
surface, input validation, logging and what reaches the browser. Reviewed on
this branch; items marked **fixed** were changed here, **by design** are
accepted trade-offs to know about.

## Credentials and secrets

| Item                                                                                                                                                                                                                                     | Status    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| No credentials in the repository; `.env` gitignored, `.env.example` placeholders only. `.gitignore` now uses `.env.*` + `!.env.example` so the example can't be accidentally ignored.                                                    | **fixed** |
| Secrets read only in `src/config/index.js`; `publicConfig()` is the single allowlist of what the bundle/HTML may contain (tested: `publicConfig never exposes secrets`).                                                                 | **fixed** |
| Tokens are sent only to their own host (`JIRA_BASE_URL`, `api.github.com`, `AI_BASE_URL`). `JIRA_BASE_URL` must be `https://`.                                                                                                           | ok        |
| Error messages include upstream response bodies (Jira/GitHub), truncated to 500 chars. These can contain ticket text but not credentials.                                                                                                | by design |
| Playwright MCP page snapshots (1.8 MB, containing real ticket titles and names) were committed; removed from the tree and ignored. **They remain in git history** of the original repository — publish from a fresh history (see below). | **fixed** |

**Recommendation:** use dedicated service accounts for Jira and GitHub with the
minimum permissions in JIRA_SETUP.md / GITHUB_SETUP.md, and rotate the tokens
when team members with access leave.

## Authentication and authorization

| Item                                                                                                                                                                                 | Status                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Vercel: every route (dashboard, bundle, writes, assistant) requires HTTP Basic Auth; 503 until configured. Constant-time comparison.                                                 | ok                        |
| Cron endpoint accepts `CRON_SECRET` bearer **or** dashboard credentials.                                                                                                             | ok                        |
| Local server binds to `127.0.0.1` by default (`HOST`), and enforces the same Basic Auth when `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` are set. Set `HOST=0.0.0.0` only behind auth. | **fixed**                 |
| Single shared credential: no per-user identity, so Jira edits are attributed to the service account, not the person.                                                                 | by design — see tech debt |
| Write features can be disabled deployment-wide (`JIRA_EDITING_ENABLED`, `REVIEW_LOGGING_ENABLED`), giving a read-only mode.                                                          | **fixed**                 |

## API surface and input validation

| Item                                                                                                                                                                                                                              | Status         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `PUT` to Jira previously forwarded **any** field name (`{fields: {[field]: value}}` default case). Now restricted to `EDITABLE_FIELDS` with per-field validation (numeric, 0–100 for AI %, non-empty summary).                    | **fixed**      |
| Issue keys are validated (`^[A-Z][A-Z0-9_]*-\d+$`) before being placed in URLs/JQL; JQL string values are quoted and escaped.                                                                                                     | **fixed**      |
| CSRF: write endpoints accept only `Content-Type: application/json` and reject requests the browser marks `Sec-Fetch-Site: cross-site`/`same-site`, so a cross-site form cannot replay the cached Basic Auth credentials (tested). | **fixed**      |
| Ticket edits are limited to `JIRA_PROJECT_KEY` tickets, even if the Jira account can edit other projects (tested).                                                                                                                | **fixed**      |
| Request bodies limited to 64 KB, JSON parse errors → 400, max 10 fields per update.                                                                                                                                               | ok / **fixed** |
| Review-log reviewer/time strings are length-limited and newline-stripped before becoming Jira comments.                                                                                                                           | ok             |
| Assistant tool names are sanitised; assistant writes require an explicit confirmation round-trip and re-validate the key/field server-side.                                                                                       | ok             |
| `GITHUB_REPOS` validated as `owner/name`; project key validated; custom field ids validated.                                                                                                                                      | **fixed**      |

## Browser / XSS

| Item                                                                                                                                                                                              | Status         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Bundle JSON is embedded with every `<` escaped as `\u003c` so ticket text cannot close the script tag. An earlier version escaped `<` to itself; the test now asserts on the whole page (tested). | **fixed**      |
| All ticket/PR text rendered through `escapeHtml`; assistant markdown renderer escapes before formatting and only links `http(s)://` URLs (allow-list, whitespace-trimmed).                        | ok             |
| No third-party scripts or CDNs; the page is fully self-contained.                                                                                                                                 | ok             |
| Headers: no CSP is set. Adding `Content-Security-Policy: default-src 'self'; script-src 'unsafe-inline'` would need the inline scripts to be nonce'd.                                             | recommendation |

## Data leaving the organisation

With the assistant enabled (`AI_API_KEY` set), ticket summaries, assignees,
points and PR titles are sent to the configured LLM provider (Groq by
default). Check this is acceptable for your client before enabling it, or
point `AI_BASE_URL` at an approved provider. Leave `AI_API_KEY` blank to keep
all data inside Jira, GitHub and your deployment.

## Logging

Logs contain ticket keys, counts and upstream error messages — never tokens.
The Basic Auth header is never logged.

## Dependencies

One runtime dependency (`@vercel/blob`). Dev dependencies: eslint, prettier.
Run `npm audit` periodically.

## Recommendations (not implemented)

1. Put the deployment behind SSO (e.g. Vercel Authentication / Cloudflare
   Access) instead of, or in addition to, Basic Auth, to get per-user identity.
2. Add a CSP header and nonce the inline scripts.
3. Add a simple audit log for writes (who/when/what) — today only the Jira
   history records edits, attributed to the service account.
