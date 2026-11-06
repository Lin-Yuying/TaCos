# Agent access upgrade: REST API keys and MCP server

Status: discussion. Written after checking Settings → Advanced → Agent access
(REST API keys) and the MCP server UI, and comparing them with how other
products implement the same two features (2026-11-06). The implementation PR is
not started; scope and open questions sit at the bottom.

## Current implementation

REST API keys:

- `createApiKey` / `verifyApiKey` in `src/lib/issues.ts`; routes under
  `src/app/api/v1/*`; UI in `src/components/settings-view.tsx`.
- `tac_` plus 192 random bits, SHA-256 hash at rest, shown once, workspace
  scoped, tied to the creator (leaves the workspace with them), revoked flag,
  last-used journal (`src/lib/api-key-usage.ts`).
- Missing: per-key scopes, expiry/rotation, rate limiting, admin gate on
  creation, and a visible key identifier after creation.

MCP server:

- `mcp/server.ts`, stdio transport, reads SQLite directly, workspace from
  `TACOS_WORKSPACE_KEY`; 10 tools; actor is `mcp`.
- Only usable where the source checkout and database live: the packaged
  payload ships `scripts/agent-mcp.mjs` (the Agent tab's per-turn shim), not
  `mcp/server.ts`, so the Settings snippet is hidden outside a source run.
- Missing: HTTP transport for a deployed team server, auth on that transport,
  tool annotations, pagination, output schema, read-only toolset, per-person
  identity.

## Researched best practice

REST API keys:

- OWASP API2:2023 — API keys are for API clients, not user authentication;
  strong tokens, rate limits, standard mechanisms.
  https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/
- GitHub personal access tokens — fine-grained tokens limited to an owner and
  specific repositories, per-permission grants, expiration, approval by the
  organization owner, prefixes, last-used and revocation.
  https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- Stripe restricted keys — per-resource permissions and rotation.
  https://docs.stripe.com/keys/restricted-api-keys
- Google API keys — API/application restrictions and rotation.
  https://cloud.google.com/docs/authentication/api-keys

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
- GitHub MCP Server — remote hosting with OAuth (and PAT), toolsets allow-list,
  read-only mode that wins over explicit write tools, page/perPage/cursor
  pagination, per-tool OAuth scopes.
  https://github.com/github/github-mcp-server
- Notion and Linear MCP — hosted servers, OAuth and enterprise-managed
  authorization, per-tool organization and security guidance.
  https://developers.notion.com/guides/mcp/overview
  https://linear.app/docs/mcp

## Candidate PR (one item, one commit; confirm scope first)

1. API keys: scopes (read-only / write, optionally one project), expiry plus a
   rotate button, per-key rate limiting, owner/admin-only creation, show
   `tac_…last4` after creation, last-used source.
2. MCP: Streamable HTTP endpoint authenticated with the same API keys so a
   deployed team server can be used remotely; keep stdio for local runs; add
   tool annotations, cursor pagination, outputSchema/structuredContent, a
   read-only toolset, and map the key creator to a real member identity.

Not in the first PR: OAuth, resources/prompts, an audit-log page.

## Open questions

- Read-only scopes first, or project-scoped keys first?
- May any member create a key, or only owners/admins?
- Remote MCP: reuse API keys now and add OAuth later?
- Rate-limit numbers per key and per workspace.
