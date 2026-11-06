# U-07: External agent platform (A2A, registry, remote agents)

Status: plan for a future PR. No implementation started. Written 2026-11-06
(loop round 4).

## Why

Today TaCos can run agents only through local CLI harnesses (#79 adds a built-in
API agent) or expose its own tools through MCP (#77). There is no way to
delegate work to an **external agent** — a vendor agent, another team's agent,
or a cloud agent — and no registry where a workspace can see and authorize
them. A2A is the emerging standard for exactly this, and the shell roadmap
(automations #80, delegation #79) needs remote agents as a first-class action
target.

## Current implementation

- Local harness adapters (`codex`, `pi`, `opencode`, `codebuddy`, `dsh`) plus
  the planned built-in API agent (#79). All run on the server or the desktop
  runner.
- TaCos tools are exposed to local agents through the per-turn MCP shim (#79)
  and to external programs through the REST API and MCP server (#77).
- Handoff/delegation runs are internal (`agent_runs`, `agent-handoff.ts`); no
  external endpoint, no agent discovery, no remote auth beyond API keys.
- No A2A client/server, no agent card, no registry, no remote push updates.

## Researched best practice

A2A (https://a2a-protocol.org/latest/topics/what-is-a2a/):

- Open standard for agent-to-agent communication across frameworks/vendors;
  complements MCP (MCP = agent to tools/data; A2A = agent to agent).
- Discovery: the client fetches the server's Agent Card
  (`/.well-known/agent-card.json`) to learn capabilities, endpoint and security
  schemes.
- Auth: security schemes from the card (OAuth/OpenID Connect/API key); HTTPS;
  opaque execution (agents do not expose internals).
- Messaging: `SendMessage` (request/response) and `SendStreamingMessage`
  (SSE task/status/artifact updates); long-running operations and push
  notifications for disconnected clients; task states and artifacts.
- A2A and MCP comparison: A2A crosses the agent boundary; MCP stays inside one
  agent (https://a2a-protocol.org/latest/topics/a2a-and-mcp/).

Adjacent references:

- MCP: TaCos already speaks it for tools; its registry/discovery model informs
  a workspace agent registry.
- Linear: third-party agents appear in the assignment menu with team access;
  workspace admins control installation and access.
  https://linear.app/docs/assigning-issues.md
- Notion: Custom Agents and External Agents are workspace-scoped, permissioned
  and audited (https://www.notion.com/help/custom-agents).
- Codex/Claude Agent SDK: harnesses can be hosted as services; A2A is the
  cross-vendor seam rather than another bespoke adapter.

## Comparison

| Capability | TaCos today | A2A ecosystem | Linear | Notion |
| --- | --- | --- | --- | --- |
| External agent discovery | None | Agent Card at well-known URL | Agent integrations | External agents |
| Transport | stdio harness only | HTTP/JSON-RPC + SSE, push | Hosted service | MCP/A2A-ish |
| Auth | Local process trust / API keys for tools | OAuth/OIDC/API key from card | Workspace/team access | OAuth connections |
| Delegation | Local handoff only | Tasks/messages across agents | Issue delegated to agent | @mention/trigger |
| Streaming/status | Internal TurnEvents | Task states, artifacts, SSE | Inbox/comments | Activity |
| Permissions | Project-bound thread | Per-agent scopes | Team access, guests | Explicit grants |
| Audit | Events for local runs | Opaque + auth logs | Activity | Activity/audit |

## Gaps, in priority order

1. **No remote agent concept.** A workspace cannot register, test, authorize or
   disable an external agent.
2. **No A2A client.** Delegated work cannot be sent to an external agent; only
   local harnesses/API loop are available.
3. **No A2A server.** TaCos cannot act as an agent for other systems (e.g. a
   parent orchestrator delegating tasks into TaCos).
4. **No registry/permissions UI.** No place to see agent cards, scopes,
   project access, last seen, or to revoke access.
5. **No remote updates/push.** Long-running external tasks cannot report back
   without polling.
6. **No cross-boundary audit/identity.** External agent actions need explicit
   attribution (agent label + owner/workspace) and audit.

## Candidate scope (one PR, four commits)

Default: client + registry in this PR; the A2A server is included only if it
stays small — otherwise a follow-up PR.

### Commit 1 — External agent model and registry

- `external_agents` table: workspace, name, description, endpoint URL, cached
  Agent Card (JSON), auth type (`none` | `bearer` | `oauth` placeholder),
  encrypted secret/token reference, project scope, enabled, created by, last
  checked/last run.
- Fetch and validate an Agent Card on add/refresh; show capabilities/skills,
  endpoint and security schemes in Settings → Agents.
- Registry list with enable/disable, test connection, last status, project
  access; audit every change.

### Commit 2 — A2A client and delegation

- A2A client (JSON-RPC over HTTP, SSE for streaming) using the Agent Card
  interface; map TaCos delegated work (#79) to `SendStreamingMessage` and map
  task/status/artifact events back to `agent_runs`/comments/review state.
- Auth: bearer token/API key first (OAuth later); secrets encrypted; requests
  signed/audited with the workspace agent identity.
- Manual "Delegate to external agent" in the task panel, and an #80 action
  target (`delegate to external agent`) for rules; retries/backoff and
  cancellation; push-notification endpoint (commit 3) or polling fallback.
- Permissions: only projects the agent is scoped to; approval policy from #79;
  results land in the task timeline/review like local runs.

### Commit 3 — Push updates and a minimal A2A server (stretch)

- Push notification config (`CreatePushNotificationConfig`) so a remote agent
  can call back when a long-running task finishes; verify signature/token and
  route to the run.
- Stretch: expose TaCos as an A2A server (Agent Card + `SendMessage`/
  `SendStreamingMessage`) so an orchestrator can delegate tasks into a
  project-scoped TaCos agent; auth via a workspace API key (#77), read/write
  scoped by the access model (U-01) and approval rules. If this grows, split
  into a follow-up PR.

### Commit 4 — UI, docs and checks

- Settings → Agents: external registry, add/refresh/test/disable, permissions
  and last activity; task panel shows the remote agent and run link.
- `check-a2a-client.ts`: fake A2A server verifies card fetch, auth, message/
  stream mapping, cancellation and error recovery.
- `check-a2a-server.ts` (if server ships): card, auth, task lifecycle,
  permission boundary.
- `check-agent-registry.ts`: registry CRUD, scoping, encrypted secrets, audit.
- README, screenshots.

## Acceptance criteria

1. An owner can register an external agent by URL; TaCos fetches and displays
   its Agent Card and rejects unreachable/invalid cards.
2. A task can be delegated to a registered external agent; status/artifacts
   stream back into the task timeline and review like a local run.
3. The external agent only reaches projects it is scoped to; its actions are
   attributed to the agent label and audited.
4. Long-running remote tasks can report completion via push; polling fallback
   works when push is not configured.
5. Disable/delete immediately blocks new delegations; secrets are encrypted and
   never returned to the browser.
6. (If server ships) an A2A client can discover TaCos, authenticate and create a
   task in a scoped project; unauthorized calls are rejected.
7. Existing local harness/API agent behavior is unchanged; tsc, i18n,
   agents-md, `check:harness` and build pass.

## Out of scope

- A public agent marketplace/directory with billing.
- Full enterprise identity federation between TaCos workspaces.
- OAuth 2.1 authorization-server implementation for external agents (start with
  bearer keys; reuse U-01/U-06 later).
- Bidirectional agent-to-agent conversations beyond task delegation.
- Replacing local harness adapters.

## Open decisions

1. Scope: A2A client + registry only (recommended) or also the A2A server in
   this PR?
2. Auth for v1: bearer/API key only (recommended) or OAuth from day one?
3. Delegation sources: manual task delegation first (recommended), then #80
   rules; or both together?
4. External agent scope: project-scoped (recommended) or workspace-wide?
5. Push notifications in v1 (recommended if the client supports it) or polling
   only?

## Dependencies

- #79 for delegation/review/run model.
- #77 for API keys and MCP (server exposure).
- #80 for automation action targets.
- U-01 for permissions/scoping and guest access.

## Files likely touched

- `src/db/schema.ts` / `src/db/client.ts` — `external_agents`, push
  registrations, indexes.
- New `src/lib/a2a/` (card fetch/validation, client, server if scoped, auth,
  push).
- `src/lib/agent-handoff.ts` / `agent-runs` — external run source and status
  mapping.
- Settings → Agents UI; task panel delegation; automations action.
- `src/lib/i18n/zh.ts`, README, new checks.
