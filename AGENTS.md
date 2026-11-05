# AGENTS.md

Guidance for AI agents (and humans) working in this repo.

## Commands

```bash
npm run dev        # dev server on :3000 (Turbopack)
npm run build      # production build (also runs type checks)
npm run lint       # eslint
npm run mcp        # run the MCP stdio server directly
npm run mcp:test   # end-to-end MCP smoke test (create/update/comment/get/delete)
npm run check:harness  # run every scripts/check-*.ts harness E2E check

npm run desktop                    # thin Electron shell pointed at a Tacos server URL
npm run desktop:dist               # electron-builder --mac (thin)
npm run desktop:dist:win           # electron-builder --win x64 (thin)
npm run server:bundle              # assemble the standalone server into dist/server/payload
npm run desktop:standalone:mac     # DMG that runs its own embedded server + private SQLite
npm run desktop:standalone:win     # Windows installer for the same (bundles the win32-x64 binding)
```

`desktop:standalone:*` rewrites `dist/server/payload` for its own platform, so build the flavour you are shipping last; `scripts/bundle-server.mjs` refuses to finish if a `.db`/`.db-wal` from this checkout survives into the payload.

No migration CLI — the SQLite schema is created/updated idempotently by `src/db/client.ts` (`CREATE TABLE IF NOT EXISTS`) on first DB access. A new column on an existing database also needs `addColumnIfMissing()` in `bootstrap()`, since `CREATE TABLE IF NOT EXISTS` never alters an existing table. Database file: `data/tacos.db` (gitignored), or wherever `TACOS_DATA_DIR` points; `TACOS_SEED_DEMO=0` skips the demo teammates/issues. Delete the database to re-seed demo data.

## Architecture

- **Three entry points share one business layer**: web UI (server actions in `src/app/actions.ts`), agent REST (`src/app/api/v1/*`), and MCP server (`mcp/server.ts`) all call `src/lib/issues.ts`. Never bypass it — it owns identifier allocation (`<PROJECTKEY>-n`), normalization (friendly status/priority aliases), auto-label creation, and activity events.
- **Status changes are owned**: only the issue's assignees may change status (being the creator is not enough); agent callers (API keys/MCP) stay unrestricted so automation keeps working. Non-assignees may still reorder cards inside a column on the board — only cross-column drags are gated. Assignments are many-to-many in `issue_assignees` and updated as a full set (`assigneeIds`). Enforce both in `src/lib/issues.ts`.
- **Project deletion is creator-or-owner**: `project.createdBy` or `workspaces.created_by` may trash/purge a project — the owner answers for the whole team, so a member's project must not become a Trash row nobody can clear. Workspace deletion stays with `workspaces.created_by` alone (backfilled to the first admin on old rows). Invited members get "Leave workspace" in the sidebar switcher. Put these checks in `src/lib/issues.ts`, not only in the UI.
- **Workspace deletion is a 30-day recycle bin, not a hard delete**: the owner must type `confirmed` (enforced in lib, not just the dialog), `workspaces.deleted_at` hides the team from every list and from `requireWorkspace`/API keys, every other member gets a `workspace_deleted` notification (shown in whatever Inbox they still have, or on `/onboarding`), and `restoreWorkspace` clears the flag within the window. `purgeExpiredWorkspaces` is a lazy sweep run when the bin is opened — there is no background job.
- **Actor attribution matters**: every mutation takes `{ actor, via }` (`you` / `api:<key-name>` / `mcp`). The UI renders this in timelines and badges. New mutations must record events.
- `src/lib/constants.ts` is the only issues-adjacent module client components may import values from (it has no DB imports). Importing values from `src/lib/issues.ts` in a client component would drag better-sqlite3 into the browser bundle. Type-only imports from issues.ts are fine.
- `better-sqlite3` must stay in `serverExternalPackages` (next.config.ts).
- With Cache Components enabled (Next 16): any component reading the DB must `await connection()` (from `next/server`) first and sit inside a `<Suspense>` boundary, because SQLite reads are synchronous and would otherwise be baked into the static shell at build time.
- Issue identifiers are allocated atomically via `INSERT ... SELECT COALESCE(MAX(number),0)+1`; the identifier column is backfilled immediately after. Don't precompute numbers client-side.
- **Schema changes only land on a fresh process**: `bootstrap()` runs once per Node process and the handle is cached on `globalThis.__tacosDb`, so a `next dev` started before a DDL edit keeps the old schema — the page then dies with `no such table: <new table>` even though `client.ts` already has it. Restart the dev server after touching the DDL (HMR does not re-run module-level side effects).
- **A wedged `next dev` shows up as a blinking window**: Turbopack can get stuck rebuilding on every HMR connect, so the page reloads ~4×/s. `notePageLoad` in `electron/main.js` counts same-URL loads and, when the shell owns the dev server, restarts it after 8 loads in 12s. A dev server someone else started is never touched — restart that one by hand.
- **Harness CLIs need a proxy on a filtered network**: the CLIs only read `HTTPS_PROXY`-style variables, never the macOS system proxy, so `cliEnv` in `src/lib/cli-agents.ts` falls back to `scutil --proxy` when Settings has no proxy and the server environment has none. Codex retries a dropped stream itself (`willRetry` on its `error` notification) — treating that as fatal is what used to strand the Agent tab on "Reconnecting…".
- **A CLI login belongs to the machine, not to a TaCos user**: Harness CLIs sign in under the OS account running the server (`~/.codex`, `~/.pi`, `~/.dsh`, and so on), so every member of a workspace may spend that subscription — `/api/ai/chat` only requires `requireCli(engine)`, and `aiEngineOptions` marks the CLI available to all. Do not reintroduce an admin-only gate without a per-workspace switch; the API engine (a provider key) remains the only billing-safe option on an untrusted server.
- **Agent conversations are TaCos records**: each thread stores its chat *and* its trajectory (`agent_threads` / `agent_messages` / `agent_steps`). `src/lib/agent-threads.ts` owns them. `/api/ai/chat` taps its own SSE stream to persist assistant text and steps, so a closed tab keeps what was already produced. Sessions are not bound to a harness or a model: switching either in the composer keeps the session. New chat always creates a new session. The old two-mode split (read-only vs write) is gone; the approval mode decides what asks.
- **Agent runs on local harness CLIs**: `src/lib/harness` holds one adapter per harness — `codex`, `pi`, `opencode`, `codebuddy` (WorkBuddy), `dsh` (DeepSeek Harness). Qoder is skipped. Each adapter has `detect` (binary, version, ready), `listModels`, `openTurn`, `install`, `upgrade`. Settings › Harness turns each one on or off (`harness_enabled`; an empty map means all on), shows version and errors, installs or upgrades, and hot-refreshes after a change. `gate.ts` dims Agent in the nav and blocks `/agent` when no harness is enabled *and* ready. The composer picks harness + model + approval (Ask / Auto / Full). Harnesses with no OS sandbox show a risk label.
- **Every TaCos write goes through the TaCos MCP path**: `/api/ai/chat` mints a per-turn grant (`issueAgentToolGrant`) and mounts `scripts/agent-mcp.mjs` as a stdio MCP server in the harness (Codex `-c mcp_servers.tacos.*`, Pi/OpenCode/WorkBuddy MCP config, dsh `--patch` overlay with `@deepseek-ai/dsh-mcp-client`). Harness builtin write tools are off. `/api/agent/tools` applies `decideToolApproval` (`src/lib/agent-tool-policy.ts`): reads run; writes ask on Ask unless the tool or turn is pre-approved; Delete always confirms, even on Full and after "Allow for this turn". Cards reach the browser through `publishToolApproval` / `subscribeToolApprovals` (or Codex elicitation) and wait on `waitForAgentApproval`. UI deletes (threads, skills) also always confirm. `tacos.create_tasks` / `tacos.update_tasks` take up to 20 items per call. The shim is part of the standalone payload (`scripts/bundle-server.mjs`); drop it and Agent has no tools.
- **Harness errors name a log file**: `loggedTurn` (`src/lib/harness/turn-log.ts`) writes stderr and the event trail per turn to `~/.tacos/logs/harness/<id>-<session>-<time>.log` (`TACOS_LOG_DIR` changes the root) and appends `Log: <path>` to each error event.
- **DeepSeek API is not dsh**: the DeepSeek API key lives under model/API settings for the API engine. It does not configure `dsh`; dsh keeps its own key (`dsh web` › Models or `DEEPSEEK_API_KEY` in its env).
- **Codex ambient servers still start**: `-c mcp_servers={}` only suppresses the default empty table, so the user's own Codex config and plugins are passed explicitly as `-c mcp_servers.tacos.*` overrides next to `-c plugins={}`. Keep approvals for `tacos.*` inside our own elicitation handler; anything else the model asks for is denied.

## Conventions

- ChatGPT-style light UI: colors/tokens in `src/app/globals.css` (`@theme`), status/priority meta in `src/lib/constants.ts`, shared row/badge glyphs in `src/components/icons.tsx`.
- Errors: throw `TacosError(message, status, hint?)` from lib code; REST maps it to `{error, hint}` JSON, actions catch it and return `{ok:false}`.
- Server actions return `ActionResult<T>` (`{ok:true,data} | {ok:false,error}`), never throw to the client.
- Font sizes come only from the scale in `src/app/globals.css`: `text-caption` 11, `text-small` 12.5, `text-body` 14, `text-lead` 16, `text-title` 18, `text-heading` 23, `text-display` 29. `scripts/check-type-scale.ts` enforces it.

## Working rules

Always-on rules for this repo. Put occasional workflows in skills or docs, and delete a rule here once a check enforces it.

- **Use one word per thing** (see Glossary). Names in code, UI copy, docs and commits follow it; add a term here before introducing a new one.
- **Reuse before building**: if a mature public component covers the need, use it instead of writing our own. Compare candidates first and record in the plan what was chosen and why. Check that the license fits MIT distribution, that it is maintained, and that the free edition covers the need. Write our own code only for what no such component covers, and say why.
- **"Done" needs evidence from outside the author**: a check script, a build, or the real flow driven end to end. Agents overrate their own work, so have a fresh context review a batch before a release. Report what was not tested.
- **Long work lives on disk**: keep a plan with a pass/fail state per item under `docs/plans/`. Each session reads it and `git log`, runs a smoke test, then takes one unfinished item. One item, one commit.
- **Stop conditions**: if the same failure survives two different fixes, mark the item blocked with the failure output and move to the next item. Never weaken a check to make it pass.
- **Copy says what to do**: no filler, no closing summaries, no vague terms in UI text or docs.
- **Numbers that change in place** (timers, counters, unread badges) use `font-variant-numeric: tabular-nums`, so they do not jump.

## Glossary

| Term | Means | In code |
| --- | --- | --- |
| Workspace | One team's shared space. Everything shared in it is visible to all its members. | `workspaces` |
| Member | A person in a workspace. | `workspace_members` |
| Project | A group of tasks and documents inside a workspace. | `projects` |
| Task | A unit of work. | `issues` |
| Subtask | A task that belongs to another task. | `issues.parent_id` |
| Blocker | A report that a task is stuck. | `blockers` |
| Document | A markdown page. Either private to its author or shared with the workspace. | `pages` |
| Harness | An agent CLI a member runs: `codex`, `pi`, `opencode`, `codebuddy`, `dsh`. | `src/lib/harness` |
| Thread / turn | A conversation with Agent / one request and its reply inside it. | `agent_threads` |

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
