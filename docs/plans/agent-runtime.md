# Agent runtime upgrade (whole Agent tab, LLM API and harness integration)

Status: research and candidate scope only. No implementation started. This is the
**whole Agent feature** — the Agent tab, its runtime, model API layer and harness
integration. It is not the Settings → Advanced → Agent access work (API keys and
MCP server), which lives in `docs/plans/agent-access.md`.

Written 2026-11-06 after reading the current code and the public agent
implementations below.

## Current implementation

The Agent tab (`src/app/[workspaceId]/agent/`, `src/components/agent-chat.tsx`)
is a team chat that runs a local CLI harness on the server machine (standalone
mode) or on the viewer's desktop runner (server mode).

- Harnesses: `src/lib/harness/` with five hand-written adapters — `codex`,
  `pi`, `opencode`, `codebuddy`, `dsh`. Each one implements
  `detect` / `listModels` / `openTurn` / optional `install` / `upgrade`
  (`src/lib/harness/types.ts`, `docs/harness-contracts.md`).
- One turn = one CLI subprocess started by the adapter. The adapter streams
  `TurnEvent` frames (delta, step, approval, error, done) over SSE; Codex uses
  its app-server JSON-RPC protocol, Pi its RPC mode, opencode `--format json`,
  codebuddy `stream-json`, dsh ACP/headless.
- TaCos writes come back through one gate: `/api/ai/chat` mounts
  `scripts/agent-mcp.mjs`, which forwards tool calls with a per-turn bearer
  token to `/api/agent/tools`. `src/lib/agent-tool-policy.ts` decides
  run/confirm (reads run, deletes always confirm, writes confirm on Ask);
  browser cards come from `publishToolApproval` / `waitForAgentApproval`.
- Persistence: `agent_threads` / `agent_messages` / `agent_steps` in
  `src/lib/agent-threads.ts`. Threads are project-bound, can be private or
  shared, pinned, unread, forked, renamed and moved; attachments and task
  chips are supported; background handoff runs live in
  `src/lib/agent-handoff.ts` and `src/lib/runner/hub.ts`.
- Model APIs: per-user OpenAI-compatible endpoints in `user_model_keys`
  (`src/lib/model-keys.ts`), encrypted with `ai-secret.ts`. They power inline
  edits and are passed to harnesses as env vars. The Agent tab itself cannot
  run on them: `action === "agent"` rejects `engine === "api"` ("Agent turns
  need a local CLI harness").
- Context: the thread history is replayed into each new turn's prompt. No
  compaction, no summary, no context meter.
- Usage/cost: `codex-gateway.ts` parses token usage from the Responses/Chat
  Completions stream, but nothing persists or displays it. There is no budget
  cap and no per-turn cost.
- Observability: per-turn timing (`turn-timing.ts`) and stderr/event logs
  (`turn-log.ts`, `~/.tacos/logs/harness/`), plus the activity timeline. No
  metrics, traces or eval harness.
- Server mode: `runner/hub.ts` issues per-user runner tokens; the desktop app
  claims queued runs and pushes events back. The Agent needs that runner
  online; there is no server-side agent loop.

## Researched best practice

Agent design:

- Anthropic, "Building effective agents": start simple; an agent is an LLM
  using tools in a loop with environment feedback; prioritise transparency,
  a carefully designed agent-computer interface, human checkpoints and
  guardrails; measure before adding complexity.
  https://www.anthropic.com/research/building-effective-agents
- Claude Agent SDK — ships the Claude Code agent loop as a library: built-in
  tools, hooks, subagents, MCP, permission modes and rules, sessions
  (continue/resume/fork, cross-host session store), automatic context
  compaction, skills/memory, plugins, max turns and max budget, and token/
  cost usage on every result.
  https://code.claude.com/docs/en/agent-sdk/overview
  https://code.claude.com/docs/en/agent-sdk/agent-loop
  https://code.claude.com/docs/en/agent-sdk/sessions
- OpenAI Codex App Server — exposes the Codex harness as a JSON-RPC service so
  other clients can drive it: thread lifecycle (start/resume/fork/archive),
  turn lifecycle, approval requests including human command checkpoints,
  model-provider configuration, MCP configuration, memory summary, telemetry
  and network policy.
  https://openai.com/index/unlocking-the-codex-harness/
  https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- Agent Client Protocol (ACP) — JSON-RPC over stdio between an editor and an
  agent subprocess; several concurrent sessions, permission requests, MCP
  configuration forwarding, UX-first streaming notifications.
  https://agentclientprotocol.com/get-started/architecture
- MCP tools spec — human in the loop, annotations treated as untrusted,
  input validation, access control, rate limits, sanitized output.
  https://modelcontextprotocol.io/specification/2025-06-18/server/tools

LLM API and model layer:

- Streaming-first responses with incremental deltas (already used for inline
  edits); tool-call streaming for a server-side agent loop.
- Retries with exponential backoff for 429/5xx, timeouts and cancellation;
  no infinite retries; surface the final error with a retry action.
- Usage accounting: input/output/cached/reasoning tokens and cost per request
  (Claude Agent SDK reports this on every result; Codex app-server exposes
  usage and telemetry).
- Budget caps: max turns and max cost per turn/session (Claude Agent SDK
  `maxTurns` / `maxBudgetUsd`).
- Prompt caching and a stable system/tool prefix; avoid rebuilding the world
  on every turn.
- Multiple providers/endpoints with fallback and model routing instead of one
  hard-coded endpoint.
- Context management: track context growth, compact/summarize old history,
  keep tool outputs and large files out of the context where possible.

## Comparison: whole agent

| Dimension | TaCos Agent today | Claude Code / Agent SDK | OpenAI Codex app-server | ACP editors |
| --- | --- | --- | --- | --- |
| Runtime | Server UI + per-user desktop runner for CLI; no server-side loop | Local CLI/SDK; SDK embeds the loop | App-server process; local or hosted client drives it | Editor spawns agent subprocess |
| Model source | CLI subscription on the host / per-user API endpoints only for inline edits | Claude API key | ChatGPT login, API key, Bedrock/GCP/custom gateways | Agent-defined |
| Agent loop | Delegated to each CLI adapter | Built in (tools → results → repeat) | Built in, exposed over JSON-RPC | Agent owns it |
| Tools | TaCos MCP tools via per-turn shim; harness tools restricted | Read/Edit/Bash/Web + MCP + custom tools | Shell/patch/plan/MCP/apps | Agent tools + forwarded MCP |
| Permissions | Ask/Auto/Full, delete always confirms, browser cards, per-turn grant | Allow/deny rules, permission modes, hooks | Approval requests, Guardian/auto review, human checkpoints | Permission requests to editor |
| Sessions | DB threads, but each turn starts a fresh CLI; history replayed | Native resume/fork, cross-host session store | Thread start/resume/fork/archive with item history | Sessions per connection |
| Context | No compaction or meter | Automatic compaction + context docs | Memory summary + rollout/history controls | Agent-defined |
| Subagents/skills/hooks | Codex-only skills; no subagents/hooks | Subagents, skills, hooks, plugins | Review/guardian workers, plugins, skills | Agent-defined |
| Usage/cost | Timing/logs only; token usage parsed but dropped | Usage + cost on every result; model usage | Telemetry and network policy | Agent-defined |
| Extensibility | Five bespoke adapters | SDK for Python/TypeScript | App-server protocol for any client | Standard ACP |

## Comparison: LLM API layer

| Dimension | TaCos today | Best practice |
| --- | --- | --- |
| Protocol | Chat Completions for inline edits; Codex gateway translates Responses ↔ Chat Completions | Prefer the provider's native agent API where available; keep an OpenAI-compatible fallback |
| Streaming | SSE pass-through for inline edits | Streaming deltas + tool-call deltas for the agent loop |
| Tool calling | Only inside the harness; the server never runs a tool loop | Server-side loop with tools, approvals and results fed back |
| Structured output | JSON mode for inline edits | Schema-validated structured output with retries |
| Retries/timeouts | One timeout (`AbortSignal.timeout`); no retry | Exponential backoff for 429/5xx, bounded retries, cancellation, retry action |
| Fallback/routing | One endpoint per person | Ordered fallback endpoints/models; health-aware routing |
| Prompt caching | Whatever the provider does | Stable system/tool prefix, explicit cache-friendly layout |
| Usage/cost | Not persisted or shown | Per-request tokens/cost, per-thread totals, per-person/workspace usage |
| Budget | None | Max turns/budget per turn and thread; stop with a clear result |
| Multi-provider | OpenAI-compatible endpoints; Codex gateway supports `/responses` when the endpoint has it | Unified client across OpenAI-compatible, Responses and Anthropic Messages APIs |

## Comparison: harness integration

| Dimension | TaCos today | Claude Agent SDK | Codex app-server | ACP |
| --- | --- | --- | --- | --- |
| Transport | One subprocess per turn, five custom protocol parsers | Library (runs the bundled CLI) | JSON-RPC app-server | JSON-RPC over stdio |
| Session resume | None: fresh CLI every turn, history replayed | Resume/fork/session store | Thread resume/fork/archive | Session per connection |
| Approvals | One TaCos gate + native Codex elicitation | Permission callback/rules | Approval requests | Permission requests |
| Model/effort | Per-turn env/args per adapter | Options | Thread/turn config | Agent-config |
| Usage | Dropped | Result usage/cost | Telemetry | Agent-defined |
| Install/version | detect/install/upgrade per adapter (good) | Bundled | Binary | Agent-managed |
| Extensibility | Write a new adapter per CLI | Embed SDK | Speak app-server | Implement ACP once |

## Gaps, in priority order

1. **No API-engine agent loop.** The Agent tab refuses `engine === "api"`, so a
   server deployment without a powered-on desktop runner cannot run an agent,
   and a member's own model key cannot power the Agent tab.
2. **No usage/cost/budget.** Token usage is parsed in the Codex gateway but
   dropped; there is no per-turn cost, no thread total, no cap.
3. **No native session continuity.** Every turn starts a new CLI session and
   replays the thread history; native resume/fork and session storage are
   unused, which costs tokens and loses tool state.
4. **No retry/fallback.** One timeout and no retry means a transient 429/5xx or
   CLI crash ends the turn.
5. **No context management.** Long threads grow until the harness truncates;
   there is no summary, no context meter and no compaction boundary.
6. **Harness-specific features stay isolated.** Skills are Codex-only; there
   are no shared hooks, subagents or command palette across harnesses.
7. **No file-change review.** Harness file edits are not shown as diffs and
   cannot be checkpointed/reverted from TaCos.
8. **No standard harness protocol.** Each new CLI means another adapter; ACP
   or an app-server-like protocol would make integrations reusable.
9. **No telemetry/evals.** Timing and stderr logs exist, but there is no
   trace/metrics/eval loop; "done" still relies on manual checks.
10. **Server mode depends on a desktop runner.** No hosted/headless option and
    no fallback when the runner is offline.

## Candidate PR3 scope (one PR, four commits)

The user asked for one PR for this third feature. Proposed commits; confirm the
scope before starting.

Commit 1 — usage, cost and budgets.

- Extend `TurnEvent` with a `usage` event carrying input/output/cached/
  reasoning tokens, model and estimated cost; adapters emit it when their
  protocol provides it (Codex gateway already parses usage; Pi/opencode/dsh
  where available).
- Persist per-turn usage (new `agent_turn_usage` table or columns on
  `agent_steps`): thread, message, engine, model, duration, tokens, cost,
  error code.
- Thread footer chip: turns, tokens, estimated cost; Settings → Agent usage:
  per-day/per-model totals for the viewer (and the workspace for admins).
- Per-turn/thread caps: max turns and max estimated cost, enforced for the
  built-in loop; adapters get `maxTurns`/time budget where supported.
- Retry button on a failed turn with the same prompt; error detail stays in
  the turn log.

Commit 2 — built-in API agent loop.

- New `src/lib/agent-api-loop.ts`: OpenAI-compatible Chat Completions with
  `tools` from `AGENT_TOOLS` in `src/lib/agent-tools.ts`; streaming deltas and
  tool-call deltas; execute tool calls through `executeAgentTool` so the
  existing approval policy (`decideToolApproval`, `publishToolApproval`,
  `waitForAgentApproval`), attribution and audit events stay identical.
- Selectable in the composer as a built-in harness (`api` engine for Agent
  turns), using the viewer's own model endpoint; works in server mode without
  the desktop runner.
- Retries with backoff on 429/5xx, timeout and cancellation; structured error
  result; max turns and budget from commit 1; persist messages/steps through
  the existing `recordTurn` path.
- Context: keep a stable system/tool prefix for prompt caching; compact older
  thread history into a summary when the token budget is reached.

Commit 3 — harness integration v2.

- Adapter contract additions: `usage` event, native session id, resume/restart
  support, error codes. Codex: store the app-server thread id and call
  `thread/resume` on the next turn; opencode/dsh: reuse their session ids;
  Pi: keep the current replay fallback (documented).
- Persist `harness_session_id` per thread (last used) so a restarted TaCos can
  resume instead of replaying.
- Transient failure handling: retry (bounded) for adapter process crashes and
  429/5xx; surface a retry action.
- Optional stretch: a generic ACP adapter so ACP-compatible agents plug in
  without new code. Confirm before including; otherwise follow-up.

Commit 4 — UX, docs, checks.

- Composer: built-in API engine option, context/token meter, budget controls.
- Thread view: usage chip, compaction boundary notice, retry/regenerate.
- Settings: Agent usage and budget section.
- README and `docs/harness-contracts.md` updates; plan status table.
- New checks: `check-agent-usage.ts` (usage parsing/persistence/caps),
  `check-agent-api-loop.ts` (fake OpenAI-compatible server: streaming, tool
  call, approval, retry, budget stop), `check-agent-session.ts` (resume
  wiring), extend `check-harness-*` and the existing agent checks.
- Smoke: tsc, i18n, agents-md, `check:harness`, build; screenshots of the
  composer/usage at 1440 and 1100.
- No real model run needed for the loop checks; one optional manual run with
  the API engine.

## Not in this PR (follow-ups)

- ACP adapter (if it does not fit commit 3), app-server-style protocol for
  third-party harnesses.
- Subagents, hooks, plugins and workspace-wide skills parity.
- File checkpointing and diff review for harness edits.
- Evals/OTel/telemetry export.
- Hosted/cloud sandbox runtime and multi-agent orchestration.
- Server-mode runner removal; the runner stays the way CLI subscriptions work.

## Acceptance criteria

1. The Agent can run a turn with the viewer's API key in server mode with no
   desktop runner online; streaming, tool calls, approvals and persistence
   behave like a harness turn.
2. Every completed/failed turn records tokens, duration and estimated cost;
   the thread chip and Settings usage agree with the recorded rows.
3. A turn stops at max turns / max budget with a clear result instead of
   running away; retry works from a failed turn.
4. 429/5xx and transient CLI crashes are retried with backoff, bounded, and
   still end in a clear error when exhausted.
5. Harnesses that support native resume reuse their session id; history is
   replayed only as a fallback, and the two paths are covered by checks.
6. Long API-loop threads compact old history and still answer follow-ups; the
   context meter warns before the cap.
7. Existing harness turns, approvals, shared threads, forks, handoff runs and
   server-mode runner behavior do not regress; `npm run check:harness`,
   `npx tsc --noEmit`, i18n, agents-md and `npm run build` pass.
8. README/docs describe the new engine and usage controls.

## Open decisions to confirm before coding

1. Scope: one PR with commits 1-3 + minimal UX (recommended), or include the
   full commit 4 and the ACP adapter? This PR is much larger than the Inbox
   one; a split may be safer after commit 2.
2. Priority: is the built-in API agent (commit 2) the must-have, with
   usage/cost (commit 1) next, or the other way around?
3. Usage display: tokens only, or estimated cost too? Cost needs a model price
   table; provide one for common providers plus a configurable per-model price.
4. Budget defaults: per-turn max turns (e.g. 30) and max cost (e.g. $1), with
   a thread cap; confirm numbers.
5. Native resume: Codex + opencode + dsh in this PR, Pi fallback; OK?
6. ACP adapter now, or recorded as a follow-up?
7. Does the Agent stay a team task assistant (TaCos tools only), or should it
   also get code/file tools like a coding agent? This PR assumes the current
   TaCos-tools scope.

## Files likely touched

- `src/lib/harness/types.ts`, each adapter — usage/session events, resume.
- `src/lib/harness/codex-gateway.ts` — surface parsed usage upward.
- New `src/lib/agent-api-loop.ts`, `src/lib/agent-usage.ts`,
  `src/lib/agent-context.ts` (compaction).
- `src/app/api/ai/chat/route.ts` — allow `engine === "api"` for agent turns,
  persist usage, retry/abort, compaction.
- `src/lib/agent-threads.ts` / `src/lib/agent-handoff.ts` /
  `src/lib/runner/hub.ts` — usage rows, session id, retry state.
- `src/components/agent-chat.tsx`, composer chips, thread footer,
  Settings → Agent usage.
- `src/db/client.ts`, `src/db/schema.ts` — new usage/session columns/tables.
- `src/lib/i18n/zh.ts`, README, `docs/harness-contracts.md`.
- New checks listed above; existing harness/agent checks updated.
