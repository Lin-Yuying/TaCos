# Agent runtime upgrade (whole Agent tab, LLM API and harness integration)

Status: research and scope. **Decided 2026-11-06: one PR covers all of it** — no
scope split. This is the whole Agent feature: the Agent tab, its runtime, the
model API layer, harness integration, and the shell-level pieces TaCos needs
because it is a control plane over agents, not another coding agent.

Not the Settings → Advanced → Agent access work (API keys and MCP server), which
is `docs/plans/agent-access.md` and draft PR #77.

## Decisions recorded (2026-11-06)

- One PR covers all five commits below.
- Delegation: the human assignee keeps ownership; an agent is delegated to the
  task (Linear-style).
- Agent identity: workspace-level named agents plus a personal "my agent".
- Review: agent completion sets a review state with approve / request changes /
  retry actions and notifications.
- Trigger scope for this PR: delegation starts a run; finish/failure sends
  notifications. A schedule/status-trigger builder is a follow-up.
- Runtime: the built-in API agent is selectable and used as the fallback when the
  desktop runner is offline.
- ACP adapter is part of commit 5; A2A stays a follow-up.
- **Usage shows tokens only** (input/output/cached/reasoning), never USD, and
  there is no model price table.
- **Budget means a usage cap, not money.** A per-run cap (turns and tokens) plus
  a monthly token allowance per agent/workspace. A run stops with a budget stop
  reason when it reaches the cap. The monthly allowance is unset (unlimited)
  until an owner sets it; the default per-run cap is 30 turns / 200,000 tokens.
- **Subscription display:** for harnesses that report plan usage, show the used
  or remaining percentage and reset window in Settings → Harness, the Agent
  composer chip and the run snapshot. Codex is the first implementation (app-
  server rate limits, CLI `/status` fallback). Harnesses that report nothing show
  "not reported" plus where to check; nothing is guessed.

## Where TaCos sits

TaCos is a **higher-level shell**, not an agent runtime. Its product is the team
workspace: projects, tasks, documents, delegation, shared visibility, approvals,
notifications and audit. Agents are borrowed runtimes — local CLI harnesses, a
model API, or (later) external A2A agents — that the shell delegates work to.

The best implementations of the shell layer are not coding agents. They are
work-management products that embed agents into their own objects:

- **Linear** lets a human assignee keep ownership while **delegating an issue to
  an agent**; the agent gets team access, appears in filters, activity and
  insights, and the human stays responsible. Delegation works from the issue
  assignee menu, triage rules and the inbox.
  https://linear.app/docs/assigning-issues.md
- **Notion Custom Agents** run shared workflows on schedules and page/database
  events, are @mentionable, get only explicitly granted pages/databases, expose
  activity and version history, can hand work to other Custom Agents, and log
  configuration changes in the audit log.
  https://www.notion.com/help/custom-agents
- **GitHub Copilot coding agent** is assigned an issue, works in a
  GitHub-hosted environment, and comes back as a draft pull request for review.
  https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
- **Asana AI teammates and Atlassian Rovo agents** put delegated work inside
  projects with permissions and activity rather than in a separate chat product.
  https://www.atlassian.com/software/rovo

Design rules that follow from being a shell:

1. **Agent as a teammate, not a separate tab.** Delegation belongs on the task:
   a human keeps ownership, an agent contributes and reports back into the task.
2. **The shell owns governance.** Project/workspace scope, approval defaults,
   budgets, usage, audit and notifications are TaCos responsibilities, not each
   adapter's.
3. **Borrow runtimes, standardise seams.** MCP for tools, ACP for local agent
   harnesses, A2A later for external agents; the built-in model-API loop is the
   fallback when no CLI/runner is available.
4. **Do not chase coding-agent features.** Browser control, file diffs and
   checkpoints belong to code agents. TaCos is the task/document workspace; its
   agents work through TaCos tools and task context.
5. **Everything visible.** A run updates the task timeline, produces a review
   request, and shows cost/usage against the agent and the workspace.

## Current implementation

Agent tab (`src/app/[workspaceId]/agent/`, `src/components/agent-chat.tsx`):

- Five hand-written harness adapters in `src/lib/harness/`: `codex`, `pi`,
  `opencode`, `codebuddy`, `dsh`. Each implements
  `detect` / `listModels` / `openTurn` / optional `install` / `upgrade`
  (`src/lib/harness/types.ts`, `docs/harness-contracts.md`).
- One turn = one CLI subprocess. The adapter streams `TurnEvent` frames (delta,
  step, approval, error, done) over SSE. Codex uses its app-server JSON-RPC
  protocol; Pi its RPC mode; opencode `--format json`; codebuddy
  `stream-json`; dsh ACP/headless.
- Every TaCos write goes through one gate: `/api/ai/chat` mounts
  `scripts/agent-mcp.mjs`, which forwards tool calls with a per-turn bearer
  token to `/api/agent/tools`. `src/lib/agent-tool-policy.ts` decides
  run/confirm (reads run, deletes always confirm, writes confirm on Ask);
  browser cards come from `publishToolApproval` / `waitForAgentApproval`.
- Persistence: `agent_threads` / `agent_messages` / `agent_steps` in
  `src/lib/agent-threads.ts`. Threads are project-bound, private or shared,
  pinned, unread, forkable, renamable, movable; attachments and task chips are
  supported.
- Shell-level delegation exists in one narrow form: an **approved task** in the
  issue panel can be handed to the viewer's own Agent (`HandoffRow`,
  `src/lib/agent-handoff.ts`). The run waits for that person's desktop runner,
  runs with approvals, reports back as a comment and a notification. It is
  personal (not a workspace agent), only for approved tasks, and starts only
  manually.
- Model APIs: per-user OpenAI-compatible endpoints in `user_model_keys`
  (`src/lib/model-keys.ts`), encrypted with `ai-secret.ts`. They power inline
  edits and are passed to harnesses as env vars. The Agent tab cannot run on
  them: `action === "agent"` rejects `engine === "api"`.
- Context: the thread history is replayed into each new turn's prompt. No
  compaction, no summary, no context meter.
- Usage/cost: `codex-gateway.ts` parses token usage from the Responses/Chat
  Completions stream, but nothing persists or displays it. There is no token
  budget and no display of a harness subscription's remaining quota.
- Observability: per-turn timing (`turn-timing.ts`) and stderr/event logs
  (`turn-log.ts`, `~/.tacos/logs/harness/`), plus the issue timeline. No metrics,
  traces or eval harness.
- Server mode: `runner/hub.ts` issues per-user runner tokens; the desktop app
  claims queued runs and pushes events back. The Agent needs that runner online;
  there is no server-side agent loop.

## Researched best practice

Agent design:

- Anthropic, "Building effective agents": start simple; an agent is an LLM using
  tools in a loop with environment feedback; transparency, human checkpoints,
  guardrails, careful agent-computer interface, measure before adding
  complexity. https://www.anthropic.com/research/building-effective-agents
- Claude Agent SDK: the Claude Code loop as a library — built-in tools, hooks,
  subagents, MCP, permission modes/rules, sessions (continue/resume/fork, cross-
  host session store), automatic compaction, skills/memory, plugins, max turns,
  max budget and usage/cost on every result.
  https://code.claude.com/docs/en/agent-sdk/overview
  https://code.claude.com/docs/en/agent-sdk/agent-loop
  https://code.claude.com/docs/en/agent-sdk/sessions
- OpenAI Codex App Server: the Codex harness exposed over JSON-RPC — thread
  start/resume/fork/archive, turn lifecycle, approval requests and human command
  checkpoints, model-provider configuration, MCP configuration, memory summary,
  telemetry and network policy.
  https://openai.com/index/unlocking-the-codex-harness/
  https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- Agent Client Protocol (ACP): JSON-RPC over stdio between a client/editor and
  an agent subprocess; several concurrent sessions, permission requests, MCP
  configuration forwarding and streaming notifications.
  https://agentclientprotocol.com/get-started/architecture
- MCP tools spec: human in the loop, annotations treated as untrusted, input
  validation, access control, rate limits, sanitized output.
  https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- A2A: the horizontal agent-to-agent layer — tasks, streaming/push updates,
  agent cards and auth — while MCP stays the vertical agent-to-tools layer.
  https://a2a-protocol.org/latest/topics/a2a-and-mcp/

Shell / embedded agents:

- Linear: human-owned issue plus agent delegation; agent access to teams;
  activity, inbox and insights cover delegated work.
  https://linear.app/docs/assigning-issues.md
- Notion Custom Agents: triggers, explicit grants, activity/version history,
  audit log, agent-to-agent handoff.
  https://www.notion.com/help/custom-agents
- GitHub Copilot coding agent: issue assignment, hosted execution, draft PR +
  review request.
  https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
- Cursor Agent: instructions + tools + model, checkpoints, subagents, skills,
  hooks, MCP, cloud agents, agent review.
  https://cursor.com/docs/agent/overview
- OpenHands SDK: sandboxed workspaces, context condenser, persistent memory,
  metrics, tracing, remote agent server, skills and plugins.
  https://docs.openhands.dev/sdk/arch/overview
- Gemini CLI: open-source terminal harness with built-in tools, MCP,
  checkpointing, token caching, telemetry, sandboxing, trusted folders and
  extensions. https://github.com/google-gemini/gemini-cli
- Devin: hosted autonomous agent with its own machine; ACP support for custom
  agents in Devin Desktop. https://docs.devin.ai/desktop/acp-custom

LLM API / model layer:

- OpenAI Responses API + Agents SDK: Responses is the model API; the Agents SDK
  adds the loop, tools, handoffs, guardrails, sessions, human-in-the-loop,
  tracing and usage. Direct Responses when you own the loop.
  https://openai.github.io/openai-agents-python/
- Claude API + Claude Agent SDK: the Messages API underneath; the SDK owns the
  loop, permissions, hooks, sessions, compaction and cost reporting.
  https://code.claude.com/docs/en/agent-sdk/overview
- LiteLLM router: load balancing, cooldowns, fallbacks, timeouts, retries with
  fixed/exponential backoff, rpm/tpm and budget limits, cost-based routing.
  https://docs.litellm.ai/docs/routing

Subscription / plan usage (for the "remaining quota" surface):

- Claude Code's status-line JSON exposes `rate_limits.five_hour.used_percentage`,
  `rate_limits.seven_day.used_percentage` and `resets_at` for Pro/Max/Ultra
  subscribers (plus a gateway spend limit). This is the clearest published shape
  for "remaining subscription".
  https://code.claude.com/docs/en/statusline
- Codex shows usage limits in the CLI `/status` and the ChatGPT usage dashboard;
  the app-server exposes account rate-limit reads that a client can display.
  https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
  Confirm the exact app-server method while wiring the Codex adapter; keep the
  `/status` text as the fallback.
- Pi, opencode, CodeBuddy and dsh do not publish a standard quota API. Show "not
  reported" and point at the CLI's own status command instead of estimating.

## Comparison: work-management shells with agents

| Capability | TaCos today | Linear | Notion Custom Agents | GitHub Copilot agent | Asana / Rovo |
| --- | --- | --- | --- | --- | --- |
| Delegation unit | Approved task handed to the viewer's own agent | Issue assigned to human and delegated to an agent | Custom Agent invoked by mention/trigger/schedule | Issue assigned to Copilot | Task/work handed to an AI teammate/agent |
| Ownership | Human keeps the task; run belongs to requester | Human assignee stays responsible | Workflow owner/creator | Agent becomes assignee | Human + AI teammate |
| Agent identity | Actor label only; no agent profile | Agents appear in assignment menu with team access | Custom Agent profile, instructions, permissions | Copilot as an assignee | Teammate-style agent identities |
| Triggers | Manual handoff; chat turn | Delegation, triage rules | Schedule, page/database events, mention | Issue assignment | Automation/agent rules |
| Scope/permissions | Project-bound thread + approval cards | Admin-managed team access | Explicit page/database grants | Repository permissions | Project/workspace permissions |
| Review/approval | Approval cards; result as comment | Comments/status; human reviews | Activity, version history, reversible runs | Draft PR + review request | Approvals and activity |
| Audit | Issue events + notifications | Activity feed | Agent activity + audit log (Enterprise) | PR/commit trail | Activity |
| Usage/budget | Tokens parsed then dropped; no plan quota | Insights on delegation | Credits | Premium request billing | Usage |
| Runtime | Local CLI + desktop runner; no API loop | Hosted agents + coding-tool integration | Hosted | GitHub-hosted cloud | Hosted |
| Collaboration | Shared threads and comments | Inbox/comments/filters | Shared workflows | PR collaboration | Team workspace |

The shell pattern is consistent: **the human owns the task, the agent is
delegated, the result comes back into the task with review, and the workspace
governs permissions, usage and audit.** TaCos has the first step (handoff) but
not identity, delegation field, review flow, governance or automation.

## Comparison: agent runtimes

| Runtime | Loop owner | Tools | Sandbox | Sessions | Context | Subagents/skills/hooks | Approvals | Usage/telemetry | Extensibility |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TaCos Agent today | Harness | TaCos MCP tools | CLI sandbox | Fresh CLI each turn, history replayed | None | Codex skills only | TaCos cards | Tokens parsed then dropped; no plan quota | Five adapters |
| Claude Code / Agent SDK | Built-in | Read/Edit/Bash/Web + MCP | Local/sandboxed | Resume/fork/store | Auto compaction | Subagents, skills, hooks, plugins | Permission modes/rules | Tokens + cost | SDK/library |
| Codex app-server | Built-in | Shell/patch/plan/MCP/apps | Sandbox + network policy | Thread resume/fork/archive | Memory summary | Review/guardian workers, plugins | Approval requests, checkpoints | Telemetry | App-server protocol |
| Cursor Agent | Built-in | Files/shell/search/web/browser/image | Local + cloud | Sessions + checkpoints | Context management | Subagents, skills, hooks, MCP | Approval/review | Usage | ACP, CLI, SDK |
| OpenHands | SDK | Tools/plugins/MCP | Sandboxed workspaces | Persisted conversations | Context condenser | Skills, persistent memory | Action confirmation | Metrics/tracing | SDK/remote server |
| Devin | Hosted | VM tools | Cloud VM | Sessions | Managed | Playbooks | Review flow | Usage | ACP/API |
| Gemini CLI | Built-in | Files/shell/web/MCP | Sandbox, trusted folders | Checkpointing | Token caching | Extensions/commands | Trust settings | Telemetry | MCP/extensions |

TaCos deliberately does not need the coding-agent columns (browser, file diffs,
checkpoints, hosted VM). It does need the shared runtime columns: usage/cost,
native sessions, retries, context management and a standard extensibility seam.

## Comparison: LLM API and framework layer

| Layer | Protocol | Loop | Tools | Sessions | Usage (tokens) | Retries/fallbacks/routing | Context |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TaCos today | Chat Completions for inline edit; Codex gateway translates Responses ↔ Chat | Harness-owned | Harness-side only | History replayed | Parsed then dropped | None | None |
| OpenAI Responses + Agents SDK | Responses API; SDK runtime | SDK | Function/hosted/MCP tools | SDK sessions | SDK usage/tracing | SDK-level retries, model providers | SDK context management |
| Claude API + Agent SDK | Messages API; SDK loop | SDK | Built-in + MCP + custom | Resume/fork/store | Usage + cost per result | Provider retries + SDK | Auto compaction |
| LiteLLM router | OpenAI-compatible proxy | Caller | Caller | Caller | Spend logs, budgets | Load balance, fallbacks, timeouts, retries, rpm/tpm | Caller |
| TaCos target | Chat Completions/Responses-compatible | Built-in loop | TaCos tools via MCP | Thread + native session ids | Token ledger + token budget | Bounded retries + fallback endpoints | Compaction + meter |

## Comparison: integration protocols

| Protocol | Layer | Transport | Sessions | Approvals | Fit for TaCos |
| --- | --- | --- | --- | --- | --- |
| MCP | Agent ↔ tools/resources | stdio, Streamable HTTP | n/a | Human-in-loop guidance | TaCos tools (already) and future external tools |
| ACP | Client/editor ↔ agent | JSON-RPC over stdio | Yes, concurrent | Permission requests | Generic harness adapter; one adapter instead of five |
| A2A | Agent ↔ agent | HTTP/REST, JSON-RPC, gRPC; streaming/push | Task-based | In-task authorization | Future cross-workspace/external agent delegation |
| Codex app-server | Client ↔ Codex harness | JSON-RPC | Thread start/resume/fork | Approval requests | Already used by the Codex adapter |
| Claude Agent SDK | App ↔ Claude Code loop | Library | Resume/fork/store | Permission callback | Alternative runtime when the viewer has a Claude API key |

## Gaps

Shell level (higher priority now that TaCos is a shell):

1. **Agents are not first-class teammates.** No workspace agent identity, no
   delegation field on tasks, no agent filters/views. Handoff is personal,
   manual and only for approved tasks; it is not a delegation model.
2. **No review loop.** Agent output lands as a comment; there is no review
   request/queue, no approve/reject/redo actions tied to the run.
3. **No workspace governance.** Project scope, harness permissions, approval
   defaults, budgets and audit for agents are not settable by an owner/admin.
4. **No token usage or plan visibility.** No per-agent, per-task or per-workspace
   token ledger, no token budget, and no display of a harness subscription's
   remaining quota; runs cannot be stopped on usage.
5. **No automation.** Delegation/status/mention triggers and scheduled agent
   runs do not exist; every run is manual.
6. **Runtime availability is hidden.** Users cannot see which agents are ready,
   whether their runner is online, or what happens when it is not; there is no
   API fallback.
7. **No external agent interop.** A2A is absent and harnesses are bespoke, so
   connecting a new agent means new code.

Runtime level:

8. No built-in API agent loop (server mode needs a powered-on desktop runner).
9. No native session continuity; every turn starts a fresh CLI with replayed
   history.
10. No retry/fallback; one timeout and no retry for transient 429/5xx or CLI
    crashes.
11. No context compaction or context meter for long threads.
12. No standard adapter contract for usage/session/error; no ACP adapter.
13. Codex-only skills; no shared hooks/subagents (out of scope for this PR but
    recorded).
14. No telemetry/evals beyond timing and stderr logs.

## What the one PR implements

Title: `feat(agent): make agents first-class in TaCos and upgrade the runtime`

One PR, five commits. This is the largest PR in this repo so far; it is scoped
to the shell plus the runtime seams, not to coding-agent features.

### Commit 1 — Agent as a teammate: identity, delegation, review

- New `workspace_agents` table: workspace, name, description, source
  (`harness` | `api`), harness/engine id, model, project scope, enabled,
  created/owner. Seeded per workspace? No — created explicitly in Settings →
  Agents; a member can start a personal agent (the current handoff) while the
  workspace can have named shared agents.
- Issue delegation: `issues.delegated_agent_id` (nullable) plus a `delegation`
  record (who delegated, when, source task/thread, status). The human assignee
  stays; delegation is displayed in the panel, filters and timeline.
- Delegate/undelegate actions in the issue panel (replacing the handoff row
  where appropriate): pick a workspace agent (or "My agent"), harness/engine,
  approval mode and note; the run starts immediately when ready, or stays
  queued with a visible "waiting for runner/API" state.
- Result flow: the run writes its result as a comment and sets a review request
  on the task (task status/review status per existing rules); the requester and
  the delegates get Inbox notifications; "Approve and close", "Request changes"
  and "Retry" actions live in the task panel and the Agent thread.
- Views: `?agent=`/`?delegated=` filters, Agent tasks quick view, agent shown in
  the task row, "My delegated tasks" in My Tasks; timeline actor attribution.
- Permissions: agent access limited to its project scope; delegation respects
  the existing claim/status ownership rules.

### Commit 2 — Built-in API agent runtime

- `src/lib/agent-api-loop.ts`: OpenAI-compatible Chat Completions (and
  Responses when the endpoint exposes it) with `tools` built from `AGENT_TOOLS`;
  streaming deltas and tool-call deltas; tool execution through
  `executeAgentTool` so `decideToolApproval`, browser approval cards,
  attribution, audit events and the per-turn grant stay identical.
- Selectable as an agent source: per-user API key (Settings → Model API),
  no desktop runner required; server mode can run it headless.
- Reliability: bounded retries with exponential backoff on 429/5xx, timeout,
  cancellation; fallback endpoint/model order; max turns and max tokens per run
  (from commit 3's budget); structured stop reasons and a Retry action.
- Context: stable system/tool prefix for prompt caching; compact older thread
  history into a summary when the token budget is reached; persist a
  `context_summary` and a compaction boundary step.

### Commit 3 — Token usage, subscription remaining, governance and audit

- Token ledger (input/output/cached/reasoning tokens, model, duration) per
  turn/run, attributed to agent, task, thread, requester and workspace. Codex
  gateway already parses usage; the API loop reports it; adapters emit what
  their protocol provides. No USD and no price table.
- Budget: (a) per-run caps — max turns and max tokens, default 30 turns /
  200,000 tokens, applied to every runtime; (b) monthly token allowance per
  agent and per workspace, unset until an owner sets one. A run that reaches a
  cap stops with a `budget` stop reason, keeps what it produced, and notifies
  the requester. Tokens are the unit because TaCos shows tokens, not money, and
  subscription harnesses are not billed per token.
- Subscription remaining: optional adapter method `subscription()` returning
  plan label, windows (used/remaining percentage, reset time) and a source
  (`app-server` | `cli` | `none`). Codex first via app-server rate limits, with
  CLI `/status` as fallback; other harnesses return `none` and render "not
  reported". Display in Settings → Harness (per row, with a refresh action), the
  Agent composer (compact chip for the selected harness), and the run panel
  (snapshot captured at run start; for server mode the snapshot comes from the
  desktop runner's capabilities). Cache with a short TTL; never guess.
- Workspace governance (owner/admin): which agent sources are enabled, allowed
  projects, approval defaults (Ask/Auto/Full per agent), monthly token allowance
  and per-run caps, and whether members may create personal agents.
- Settings → Agents: agent list, edit/create, enable/disable, token budget,
  token usage, subscription state, last runs; Settings → Agent usage:
  per-day/per-agent/per-task token totals.
- Audit: agent configuration changes, delegations, approvals/denials, budget
  stops and run results go into the existing events/activity stream; an admin
  audit view lists them.
- Inbox: new notification types for delegation accepted/started, review
  requested, budget stopped and failed; reused by the shell commit.

### Commit 4 — Automation and host visibility

- Triggers: delegate-to-agent starts a run (manual or on assignment); a task
  moving to a configured status can start/queue an agent run; finish/failure
  sends review/failure notifications. Scheduled runs are included only if the
  existing cron/reminder plumbing can do it without a new daemon.
- Runner visibility: Agent page/Settings show runner online state, ready
  harnesses, and a clear fallback to the built-in API runtime when the runner
  is offline.
- Handoff rows and the new delegation flow share one queue/state machine
  (`agent_runs`), so cancel/retry/approval behave the same for both.

### Commit 5 — Harness integration v2, UX, docs, checks

- Adapter contract additions: `usage` event, native session id, resume/restart
  support and error codes. Codex: persist the app-server thread id and call
  `thread/resume`; opencode/dsh: reuse their session ids; Pi keeps the replay
  fallback and documents it. Retry transient adapter crashes (bounded).
- Generic ACP adapter: run an ACP-compatible agent subprocess (JSON-RPC over
  stdio), map sessions and permission requests to the existing TurnEvent and
  approval cards; register as an agent source. This is the "one adapter, many
  agents" path; keep the five existing adapters working.
- UX: Agent tab and task panel show model/source, usage chip, context meter,
  review state; composer selects API agent/workspace agent; new Settings pages;
  retry/cancel; empty/offline states.
- Docs: README, `docs/harness-contracts.md`, `docs/plans/agent-runtime.md`;
  plan status table.
- Checks: `check-agent-delegation.ts` (delegate, ownership, filters, review,
  notifications), `check-agent-usage.ts` (token ledger, token budget stop,
  attribution), `check-agent-subscription.ts` (adapter mapping for Codex rate
  limits, "not reported" fallback, composer/Settings rendering), `check-agent-
  api-loop.ts` (fake OpenAI-compatible server: streaming, tool call with
  approval, retry/backoff, budget stop, compaction), `check-agent-session.ts`
  (native resume wiring, ACP basic handshake), plus updates to the existing
  harness/agent checks. Smoke, `check:harness`, build, screenshots at
  1440/1100.
- Manual: one real desktop handoff run and one API-engine run.

## Out of scope (recorded follow-ups)

- Coding-agent features: browser control, file diffs, checkpoints, subagents,
  hooks, plugins, hosted VM/cloud sandbox.
- A2A external agent registry and cross-workspace agent delegation.
- Multi-agent orchestration (manager/subagents) inside TaCos.
- Evals/OTel export and a full observability backend.
- Email/push notification channels (Inbox PR covers in-app).
- Removing the desktop runner: it stays for CLI subscriptions.

## Acceptance criteria

1. A workspace agent exists as a named, project-scoped teammate; a task can be
   delegated to it while the human assignee keeps ownership, and the run reports
   back with review actions, timeline events and notifications.
2. My Tasks / Agent tasks / filters show delegated work consistently; the agent
   appears in the task panel and in the run timeline.
3. An owner/admin can enable/disable agent sources, limit projects, set approval
   defaults and budgets, and see the audit list of agent actions.
4. Every completed/failed run records input/output/cached/reasoning tokens, model
   and duration against the agent/task/workspace; the usage pages agree with the
   ledger, and no USD or price estimate appears anywhere.
5. A run stops at the turn/token cap with a clear reason; retry works; transient
   429/5xx and CLI crashes are retried with backoff and bounded.
6. Settings → Harness, the Agent composer and the run panel show the harness
   subscription's used/remaining percentage and reset window when the harness
   reports it (Codex), and "not reported" with the CLI status command when it
   does not.
7. The built-in API agent runs a turn in server mode with only the viewer's API
   key (no desktop runner), with streaming, tools, approvals and persistence
   behaving like a harness turn.
8. Harnesses with native sessions resume instead of replaying; the ACP adapter
   can run at least one ACP-compatible agent and maps permission requests to
   approval cards.
9. Long API-loop threads compact and still answer follow-ups; the context meter
   warns before the cap.
10. Existing harness turns, handoff runs, shared threads, forks, approvals and
    runner behavior do not regress; `npm run check:harness`, `npx tsc --noEmit`,
    i18n, agents-md and `npm run build` pass.
11. README/docs describe agents, delegation, review, token usage/budgets, the
    subscription display, the API engine and harness integration.

## Remaining confirmations

The decisions above follow the owner's "other items as recommended". Only the
numbers and the subscription surfaces are worth a final look:

1. Per-run cap defaults: 30 turns and 200,000 tokens; the monthly token
   allowance stays unset (unlimited) until an owner sets one. Adjust the
   numbers if they are wrong for the team's subscriptions.
2. Subscription surfaces: Settings → Harness row (detail + refresh), Agent
   composer chip (compact), and the run panel snapshot. If one place is enough,
   drop the run snapshot; if a fourth place is wanted (Agent page header), say
   so.
3. Codex is the only harness with a published quota source today. If another
   harness gains one (for example a Claude Code harness later, using the
   status-line `rate_limits` shape), wiring it is a small adapter addition, not
   a new UI.

## Files likely touched

- `src/db/client.ts`, `src/db/schema.ts` — `workspace_agents`, delegation
  fields/table, usage ledger, budget/policy, context summary; idempotent
  bootstrap and indexes after columns.
- `src/lib/issues.ts`, `src/lib/agent-threads.ts`, `src/lib/agent-handoff.ts`,
  `src/lib/runner/hub.ts` — delegation, review status/actions, run queue,
  notifications, attribution.
- New `src/lib/agent-api-loop.ts`, `src/lib/agent-usage.ts`,
  `src/lib/agent-context.ts`, `src/lib/agent-acp.ts`.
- `src/lib/harness/types.ts`, adapters, `codex-gateway.ts` — usage/session/
  error/subscription contract, native resume, retry, Codex rate-limit mapping.
- `src/app/api/ai/chat/route.ts`, `/api/agent/*`, new review/delegation actions.
- `src/components/agent-chat.tsx`, `agent-chat` subcomponents,
  `issue-panel/handoff-row.tsx` → delegation/review controls; settings pages.
- `src/components/notifications-view.tsx` (if new notification types need copy
  or filters; no Inbox redesign here).
- `src/lib/i18n/zh.ts`, README, `docs/harness-contracts.md`.
- New checks listed above (including `check-agent-subscription.ts`); existing
  harness/agent checks updated.
