# Agent access upgrade: REST API keys and MCP server

Status: implemented on `feat/agent-access` (2026-11-06), four commits. Not merged;
the Lead runs the browser E2E and screenshots.
Written after checking Settings → Advanced → Agent access and comparing the two
features with the public products below.

Recorded decisions:

- One PR covers both features; commits may be split by section.
- Existing API keys keep working (legacy rows are full access with no expiry).
- Remote MCP uses **Streamable HTTP authenticated by the same API keys**.
  OAuth 2.1 is a follow-up, not this PR.
- The stdio MCP server stays for local/self-hosted use.
- Keys get read/write scopes, an optional project allowlist, expiry, rotation,
  per-key rate limits and owner/admin revocation. Any member may create a key;
  it stays bound to its creator.
- Decisions confirmed with the owner (2026-11-06): expiry choices are
  30/90/365 days with 90 as default; "never expires" is admin-only; the
  project allowlist ships in this PR; any member may create a key; rate limits
  are 120 reads/min and 60 writes/min with burst 20; the remote MCP endpoint is
  stateless first; the current 10 tool names stay unchanged.
- Implement exactly this in the API-keys/MCP PR; do not mix in Inbox work.

## Current implementation

REST API keys:

- `createApiKey` / `verifyApiKey` in `src/lib/issues.ts`; routes under
  `src/app/api/v1/*`; UI in `src/components/settings-view.tsx`.
- `tac_` plus 192 random bits, SHA-256 hash at rest, shown once, workspace
  scoped, tied to the creator (leaves the workspace with them), revoked flag,
  last-used journal (`src/lib/api-key-usage.ts`).
- Missing: per-key scopes, project restriction, expiry/rotation, rate limits,
  owner/admin gate on creation, and a visible key identifier after creation.

MCP server:

- `mcp/server.ts`, stdio transport, reads SQLite directly, workspace from
  `TACOS_WORKSPACE_KEY`; 10 tools; actor is `mcp`.
- Only usable where the source checkout and database live: the packaged
  payload ships `scripts/agent-mcp.mjs` (the Agent tab's per-turn shim), not
  `mcp/server.ts`, so the Settings snippet is hidden outside a source run.
- Missing: HTTP transport for a deployed team server, auth on that transport,
  tool annotations, pagination, output schemas, read-only mode, per-person
  identity.

## Researched best practice

REST API keys:

- OWASP API2:2023 — API keys are for API clients, not user authentication;
  strong tokens, rate limits, standard mechanisms.
  https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/
- GitHub fine-grained PATs — owner/repository scoping, per-permission grants,
  expiration, organization approval, prefixes, last used and revocation.
  https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- Stripe restricted keys — `rk_live_`/`rk_test_`, per-resource
  None/Read/Write, rotation with delayed expiration, request logs, 2FA, one key
  per service, recommended for agent keys.
  https://docs.stripe.com/keys/restricted-api-keys
- OpenAI keys — project keys with expiration, admin-enforced maximum lifetime,
  rotation process, workload identity for machines, IP allowlisting, usage
  monitoring and spend limits.
  https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety
- Notion connection capabilities — granular Read/Update/Insert content,
  comment and user capabilities; request the minimum.
  https://developers.notion.com/reference/capabilities

MCP servers:

- Tools spec — human in the loop, untrusted annotations, inputSchema,
  outputSchema/structuredContent, pagination, server-side validation, access
  control, rate limits, sanitized output.
  https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- Transports — stdio locally; Streamable HTTP for remote servers.
  https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- Authorization — OAuth 2.1 for HTTP transports, audience-bound tokens.
  https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- Security best practices — confused deputy, token passthrough, SSRF, scope
  minimization; local stdio provenance and credential isolation.
  https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices
- GitHub MCP Server — remote Streamable HTTP with OAuth/PAT, toolset URLs and
  headers, read-only mode, lockdown, insiders, page/perPage/cursor pagination,
  per-tool OAuth scopes.
  https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md
- Linear MCP — hosted Streamable HTTP at `mcp.linear.app/mcp`, OAuth 2.1 with
  dynamic client registration, bearer/API-key auth, a dedicated read-only
  endpoint and read scope, enterprise-managed authorization.
  https://linear.app/docs/mcp.md
- Stripe MCP — hosted Streamable HTTP at `mcp.stripe.com`, OAuth for
  interactive clients and agent API keys for autonomous clients, restricted
  permissions, human confirmation in the Dashboard for sensitive actions,
  per-team MCP access, revocable OAuth sessions, tool-call logs.
  https://docs.stripe.com/mcp.md
- Notion MCP — hosted remote server with OAuth and enterprise-managed
  authorization, connection capabilities, security guidance.
  https://developers.notion.com/guides/mcp/overview

## Comparison: API keys

| Product | Key shape | Permission granularity | Expiry / rotation | Rate limits | Revoke / last used | Creation & admin |
| --- | --- | --- | --- | --- | --- | --- |
| **TaCos today** | `tac_` + 48 hex, shown once, SHA-256 at rest | Workspace read+write only | None | None | Revoked flag + last-used journal | Any member creates; creator/owner/admin revokes |
| Stripe restricted | `rk_live_` / `rk_test_` | Per resource: None / Read / Write | Expiry, rotation with up to 7-day delayed expiration | Account-level | Revoke, request logs, key list | 2FA to create, notes, one key per service |
| GitHub fine-grained PAT | `github_pat_` | Owner + selected repos + per-permission | Expiration; org approval; revoke | API/rate limits | Last used, security log, revoke | User creates; org policy/approval |
| OpenAI project keys | `sk-…` project keys | Project + per-key permissions | Expiry, admin max lifetime, rotation, workload identity | Org/project limits, spend limits | Revoke, usage dashboard | Admin controls, IP allowlist |
| Notion capabilities | Connection token / PAT | Capabilities: read/update/insert content, comments, user info | Re-auth when capabilities change | API limits | Revoke connection | Workspace owner installs connection |
| Linear API key | Bearer API key | Read-only option for MCP/API; OAuth scopes for apps | OAuth tokens expire; API key revocable | API limits | Revoke in settings | User creates; workspace admin can revoke |

Gap for TaCos: the key has no scope, cannot be rotated or expired, cannot be
restricted to a project, has no rate limit, and does not show a stable
identifier after creation. The hashing, show-once, creator binding and last-used
tracking already match the minimum bar.

## Comparison: MCP servers

| Product | Transport / host | Auth | Read/write control | Tool organisation & pagination | Identity / audit | Human confirmation |
| --- | --- | --- | --- | --- | --- | --- |
| **TaCos today** | stdio only, local DB | None (local process trust) | All 10 tools writable for every caller | None; `limit` but no cursor | Actor `mcp` | Client-side only |
| GitHub remote | Streamable HTTP + local stdio | OAuth 2.1 / PAT | Toolset URLs, `/readonly`, lockdown | Toolsets, page/perPage/cursor | OAuth scopes per tool | Client approval |
| Linear remote | Streamable HTTP | OAuth 2.1 + DCR; bearer/API key | `/readonly` endpoint and `read` scope | Tools for issues/projects/docs/comments | OAuth sessions; enterprise-managed auth | Client approval |
| Stripe remote | Streamable HTTP | OAuth or agent API key | `stripe_api_read` / `stripe_api_write` | Tool grouping; read/write split | OAuth sessions, tool-call logs | Dashboard confirmation for sensitive actions |
| Notion remote | Streamable HTTP | OAuth; enterprise-managed auth | Connection capabilities | Tools grouped by resource | OAuth connection | Client approval |
| TaCos target | stdio (local) + Streamable HTTP `/api/mcp` (remote) | Bearer API key with scopes | Read-only scope hides/rejects write tools | Tool annotations, cursor pagination, output schemas | Actor `api:<key name>`, via `mcp` | Client approval retained |

## What the one PR implements

Title: `feat(agent-access): scoped API keys and remote MCP over Streamable HTTP`

Commit 1 — API keys: scopes, project allowlist, expiry, rotation, rate limits.

- Schema (`src/db/client.ts` + `src/db/schema.ts`, all via
  `addColumnIfMissing()`): `api_keys.scopes` JSON (`null` = legacy full
  access), `api_keys.project_ids` JSON (`null` = all projects),
  `api_keys.expires_at`, `api_keys.rotated_from`, `api_keys.key_prefix`,
  `api_keys.last4`, `api_keys.last_used_ip`.
- `createApiKey(workspaceId, name, scopes, projectIds, expiresInDays, createdBy)`
  keeps `tac_` + 48 hex; stores SHA-256 hash plus prefix/last4 for display.
  Returns the plaintext once.
- Read/write scopes: `read` allows `GET`; `write` implies read. Enforced in
  `src/lib/api-auth.ts` helpers (`requireApiKey` returns scopes; add
  `assertKeyScope` / `assertKeyProject`), so every `/api/v1/*` route rejects a
  read-only or out-of-project request with 403. Expired/revoked keys return 401.
- Project allowlist: `project_ids` limits list results and rejects writes to
  other projects. `null` keeps full access for legacy and new "all projects"
  keys; the create form defaults to "All projects" and does **not** force a
  selection, so a key can still mean the whole workspace.
- Expiry: choice of 30 / 90 / 365 days, default 90; "never expires" is
  admin-only, and legacy keys keep no expiry. `expires_at` checked in
  `verifyApiKey`.
- Rotation: "Rotate" creates a replacement with the same name/scopes/projects,
  shows it once, revokes the old key in the same transaction, records
  `rotated_from`. **The old key dies immediately; there is no grace window in
  this PR** (a delayed-expiry rotation stays a follow-up if a consumer needs it).
- Rate limits: per-key in-memory token bucket — 120 reads/min and 60
  writes/min, burst 20; 429 with `Retry-After`. Single-process by design; the
  team server runs one Next.js process, like the existing badge polling.
- Last-used: keep the journal, add the request IP; `/api/v1/me` returns scopes,
  project count, expiry and last used.
- Settings UI: key table (name, `tac_…last4`, scopes, projects, created,
  expires, last used/IP, actions), create form (scope checkboxes, expiry,
  project multi-select), Rotate and Revoke buttons; expired keys show a badge.
- Copy: zh + en strings for the new UI and errors.

Commit 2 — MCP Streamable HTTP endpoint with API-key auth.

- Refactor `mcp/server.ts` into `createMcpServer({ workspaceId, actor,
  readOnly, allowedProjectIds, toolFilter })`; keep the stdio entry as a thin
  wrapper so `npm run mcp` and `npm run mcp:test` stay working.
- New `src/app/api/mcp/route.ts` using
  `WebStandardStreamableHTTPServerTransport` from
  `@modelcontextprotocol/sdk/server/webStandardStreamableHttp`
  (`nodejs` runtime). Stateless: a new server per POST request, no session id;
  no server-initiated notifications in this PR.
- Auth: `Authorization: Bearer tac_…` verified with the same
  `requireApiKey`; scope and project checks apply to tool calls. Missing or
  invalid key → 401 with the same hint as REST.
- Actor: `{ kind: "agent", label: "api:<key name>", via: "mcp" }`, so timelines
  and events attribute remote MCP writes to the key, not a generic `mcp`.
- Rate limits reuse the per-key buckets from commit 1.
- Settings UI: MCP block shows two snippets — local stdio command and
  `claude mcp add --transport http tacos <origin>/api/mcp --header
  "Authorization: Bearer tac_…"` — plus the read-only note.

Commit 3 — tools: annotations, pagination, output schema, read-only/toolsets.

- Annotations on every tool: `readOnlyHint` (list/get), `destructiveHint`
  (delete), `idempotentHint` (get/update), `openWorldHint: false`.
- Cursor pagination for `list_issues`, `list_labels`, `list_projects`,
  `list_members`: `cursor` input and `nextCursor` in the result; keyset on
  `(created_at,id)` (issues) and stable keys for the rest.
- `outputSchema` + `structuredContent` for the list/get tools so clients can
  validate results.
- Read-only enforcement: a `read`-scoped key registers/serves only read tools;
  write calls return a tool error naming the required scope. stdio gets
  `TACOS_MCP_READ_ONLY=1` and `TACOS_MCP_TOOLS` (comma-separated allowlist)
  equivalents, mirroring GitHub's `--read-only` / `--tools`.
- Tool names and input schemas stay backward compatible; the Agent tab's
  `scripts/agent-mcp.mjs` shim is untouched.

Commit 4 — checks, docs, i18n.

- `check-api-key-scopes.ts`: read-only 403, project 403, expired/rotated 401,
  legacy key still works, `/me` fields, 429 with `Retry-After`.
- `check-mcp-http.ts`: SDK client against a test server — initialize,
  `tools/list` annotations, read call, read-only write rejection, cursor
  pagination, missing-key 401.
- Extend `scripts/test-mcp.ts` for stdio read-only/tool filter; keep the
  existing `check-mcp-write-delete-e2e.ts` green.
- Update `README.md` API and MCP sections, the Settings copy, and the plan's
  status table.
- Run smoke (`tsc`, `i18n:check`, `check-agents-md`) and
  `npm run check:harness`; capture screenshots of the new key table and MCP
  block at 1440/1100.

## Acceptance criteria

1. Legacy keys keep working for REST and stdio MCP; they show as full access
   with no expiry and cannot be "downgraded" by accident.
2. A read-only key can GET everything its workspace allows, and receives 403
   for POST/PATCH/DELETE with a message naming the missing scope.
3. A project-scoped key sees and writes only its projects; other projects are
   absent from lists and rejected on writes.
4. Expired, revoked and rotated-away keys return 401 immediately; rotation
   returns the new key exactly once.
5. Per-key rate limits return 429 with `Retry-After` and do not leak across
   keys or workspaces.
6. The remote MCP endpoint works from Claude Code with a bearer key:
   `initialize` succeeds, tools carry annotations, a read-only key cannot call
   write tools, and `nextCursor` paginates beyond one page.
7. stdio MCP is unchanged: `npm run mcp` and `npm run mcp:test` pass without a
   database migration failing.
8. Settings shows prefix/last4, scopes, projects, expiry and last used;
   Chinese and English copy are complete; the MCP snippets are copy-paste
   ready.
9. `npx tsc --noEmit`, `npm run -s i18n:check`,
   `npx tsx scripts/check-agents-md.ts`, `npm run check:harness` and
   `npm run build` pass.
10. No regression in the existing checks for tasks, Inbox, desktop updates or
    upgrade boot.

## Status (2026-11-06)

| Item | State | Evidence |
| --- | --- | --- |
| API keys: scopes, projects, expiry, rotation, rate limits, UI | done | `0fe9208` |
| MCP: `createMcpServer`, stdio wrapper, `/api/mcp` Streamable HTTP | done | `4aa22dd` |
| MCP tools: annotations, cursor pagination, output schemas, read-only/tool filters | done | `8714537` |
| Checks, README, i18n | done | this commit |
| Type check / build | pass | `npx tsc --noEmit`, `npm run build` |
| Harness checks | pass | `npm run check:harness`: 110/110 |
| MCP smoke + new checks | pass | `npm run mcp:test`, `check-api-key-scopes.ts`, `check-mcp-http.ts` |
| Browser E2E + 1440/1100 screenshots | not run here | Lead runs them |

Notes for the reviewer:

- The new columns are nullable and land in both the `CREATE TABLE` and
  `bootstrap()` via `addColumnIfMissing()`; a dev server started before the DDL
  edit keeps the old handle, so it must be restarted (no manual migration).
- In this worktree `node_modules` was a symlink to the Lead's checkout, which
  Turbopack refuses to resolve for a production build. It was replaced with a
  local copy (gitignored) only to produce the build evidence above.
- `npm run lint` is red on `main` too (84 errors in untouched files); this
  branch adds none.

## Not in this PR (follow-ups)

- OAuth 2.1 authorization server, dynamic client registration, enterprise
  managed authorization.
- Per-tool OAuth scopes, MCP resources/prompts, registry listing.
- IP allowlists, spend limits, a security-audit page.
- Expiry warning emails / notifications.
- Stateful HTTP sessions and server-initiated notifications/resumability.

## Decisions (confirmed 2026-11-06, no open questions)

- Expiry: 30 / 90 / 365 days, default 90; "never expires" is admin-only and
  legacy keys keep no expiry.
- Project allowlist ships in this PR.
- Any workspace member may create a key (creator-bound). The creator, owner or
  an admin may revoke it.
- Rate limits: 120 reads/min and 60 writes/min per key, burst 20, 429 with
  `Retry-After`.
- The HTTP MCP endpoint is stateless in this PR; stateful sessions are a
  follow-up.
- Keep the current 10 MCP tool names and input schemas; only add annotations,
  cursor pagination, output schemas and read-only filtering.
- No OAuth in this PR; bearer API keys only.
- Rotation revokes the old key immediately (no grace window).
- The project allowlist is optional; no selection means all projects.
- Last used time and IP are shown in the key table (stored, not used for
  enforcement).

## Files the PR touches

- `src/db/client.ts`, `src/db/schema.ts` — new `api_keys` columns, idempotent
  bootstrap, legacy defaults.
- `src/lib/issues.ts` — `createApiKey`, `verifyApiKey`, `listApiKeys`,
  `revokeApiKey`, rotation, scopes/projects/expiry types, `/me` view; no change
  to issue business rules.
- `src/lib/api-auth.ts` — scope/project helpers and error mapping; rate-limit
  hook.
- New `src/lib/api-key-rate-limit.ts` — per-key token bucket.
- `src/app/api/v1/*` — enforce scope/project in each route; `/me` returns the
  new fields.
- `src/app/api/mcp/route.ts` — new Streamable HTTP endpoint.
- `mcp/server.ts` — split into `createMcpServer` + stdio wrapper; annotations,
  pagination, output schemas, read-only/tool filters.
- `src/components/settings-view.tsx` + `src/app/[workspaceId]/settings/page.tsx`
  — key table/create/rotate/revoke UI, MCP snippets, scope/project pickers.
- `src/lib/i18n/zh.ts` — new copy.
- `README.md` — API keys, REST and MCP setup.
- `scripts/check-api-key-scopes.ts`, `scripts/check-mcp-http.ts` (new);
  `scripts/test-mcp.ts`, `scripts/check-mcp-write-delete-e2e.ts` (extend).
