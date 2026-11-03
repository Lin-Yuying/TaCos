# H-P0-04 Final contracts (adapter, approval, session, gate)

Status: frozen for implementation. Date: 2026-11-03 America/Los_Angeles.
Trace id: H-P0-04.
Inputs: H-P0-01, H-P0-02, H-P0-03 findings.

Write product text in ASD-STE100. This document is the design authority for H-P1+ coding ids.

## 1. Product rules (locked)

1. Clean cutover. Delete Chat/Work mode, Work≡Codex gates, Pi `--no-tools` / `--no-mcp` hard gates, and unused engine APIs. Do not keep compatibility shims.
2. First-class harnesses: `codex`, `pi`, `opencode`, `dsh`, `codebuddy` (WorkBuddy). `qoder` stays optional / skipped.
3. DeepSeek API (LLM provider) is not the DeepSeek harness (`dsh`).
4. Settings → Harness: list, on/off, version, ready, errors; live update check; one-click install/update with hot refresh.
5. Agent page is disabled when no harness is enabled and ready.
6. Composer shows harness + model + approval.
7. Delete actions always confirm, even when approval is Full.
8. Sessions are unbound from harness/model. New chat creates a new session.
9. Per-user / per-machine local CLI only. No Morula router.

## 2. Harness identity

| id | CLI binary | Install (primary) | Version probe | Notes |
|---|---|---|---|---|
| codex | `codex` | `npm i -g @openai/codex` | `codex --version` | Auth `~/.codex/auth.json` |
| pi | `pi` | `npm i -g @earendil-works/pi-coding-agent` | `pi --version` | Auth `~/.pi/agent/auth.json` |
| opencode | `opencode` | curl `https://opencode.ai/install` → `~/.opencode/bin` | `opencode --version` | Also npm `opencode-ai` |
| codebuddy | `codebuddy` (aliases `cbc`) | `npm i -g @tencent-ai/codebuddy-code` | `codebuddy --version` | Product name WorkBuddy |
| dsh | `dsh` | `npm i -g @deepseek-ai/dsh` | `dsh -V` | Node `^22.19 \|\| >=24` |

Detect must search env overrides, known paths (including nvm global bin via login shell `command -v`), then mark missing.

Ready means: binary found, version readable, and harness-specific auth/provider readiness when that harness requires it.

## 3. Adapter contract (`src/lib/harness/`)

Each harness adapter implements one stable interface (names may match TypeScript later):

```
HarnessId
detect(): { installed, binary, version, ready, error, hint }
listModels(): ModelOption[]
openTurn(input: TurnInput): AsyncIterable<TurnEvent>
install?(): Promise<InstallResult>
upgrade?(): Promise<InstallResult>
```

`TurnInput` contains:

- `sessionId` (agent thread id)
- `cwd`
- `prompt` / message history handle
- `model` + optional effort/variant
- `approval`: `ask` | `auto` | `full`
- `mcp`: stdio command/args/env for TaCos tools (when tools are enabled for the turn)
- `autoApproveTools`: read-only tool names
- `isTurnApproved(): boolean`
- `signal`

`TurnEvent` union (SSE frames to the browser):

- `delta` text
- `step` trajectory
- `approval` request card
- `approval_done`
- `error`
- `done`

Adapters own CLI process lifecycle. They never write the TaCos database. Tool writes go through the TaCos MCP shim + `/api/agent/tools` with a per-turn grant.

### Adapter notes per harness

- **codex**: keep app-server + `mcpServer/elicitation/request` accept/decline. Map sandbox as today for ask/auto vs full.
- **pi**: use `--mode rpc` (or equivalent host protocol). Do not rely on Pi for per-tool Allow/Deny. Gate writes in TaCos (MCP grant / tool API) and surface cards from that gate. Show no-sandbox risk label.
- **opencode**: prefer `run --format json` or ACP/serve permission events. Map `--auto` only to TaCos `auto`/`full` with care.
- **codebuddy**: `--print --output-format stream-json` + `--permission-mode` / MCP config. Never default to `-y`.
- **dsh**: use `acp` or `headless` profiles after install. Prove Allow/Deny before `ready`.

## 4. Approval events

Browser card fields stay:

- `requestId` (unique per turn; include session id)
- `tool` (`server.tool`)
- `message`, `description`, `params`

Decisions:

- Allow → accept once
- Deny → decline (default on timeout / abort)
- Allow for this turn → mark grant `autoApproveTurn`

Policy:

| TaCos approval | Behavior |
|---|---|
| ask | Every write waits for a card unless turn-approved or listed read auto-approve |
| auto | Routine writes may pass; risky/delete still confirm in TaCos |
| full | Harness may skip its own prompts where supported; **TaCos delete tools still confirm** |

Harnesses without a native Deny path (Pi) still show TaCos cards because the tool API blocks until `answerAgentApproval`.

## 5. Session contract

- Session = `agent_threads` row (+ messages/steps).
- New chat → `startAgentThread` → new id.
- Switch harness/model/approval → same session id; prefs apply to the next turn.
- Thread may store last-used harness/model/approval for UI restore only.
- Remove `mode` chat/work from product behavior (schema cleanup in H-P1-06/08).
- Auth table `sessions` remains unrelated login state.

## 6. Gate contract

`harnessGate` (settings + Agent layout):

```
{ enabledReady: HarnessStatus[]; anyReady: boolean; agentAllowed: boolean }
```

Rules:

1. User (or workspace settings) can disable a detected harness.
2. `agentAllowed` is true only if at least one harness is enabled and ready.
3. If `agentAllowed` is false, Agent page renders a setup state (install/enable), not the composer.
4. After install/upgrade, refresh detect without a full app reload (hot refresh).

## 7. E2E matrix (every adapter id)

1. detect → ready
2. open session (existing or new)
3. MCP edit one task
4. Allow / Deny / Allow-for-this-turn
5. settings toggle on/off
6. update + hot refresh
7. delete action still confirms on Full

## 8. Implementation order reminder

P1 foundation registry + delete old gates + unbound session + Codex end-state path, then P2 settings, P3 Agent page, P4 other adapters, P5 hardening.

