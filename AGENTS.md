# AGENTS.md

Guidance for AI agents (and humans) working in this repo.

## Commands

```bash
npm run dev        # dev server on :3000 (Turbopack)
npm run build      # production build (also runs type checks)
npm run lint       # eslint
npm run mcp        # run the MCP stdio server directly
npm run mcp:test   # end-to-end MCP smoke test (create/update/comment/get/delete)

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
- **Codex/Pi need a proxy on a filtered network**: the CLIs only read `HTTPS_PROXY`-style variables, never the macOS system proxy, so `cliEnv` in `src/lib/cli-agents.ts` falls back to `scutil --proxy` when Settings has no proxy and the server environment has none. Codex retries a dropped stream itself (`willRetry` on its `error` notification) — treating that as fatal is what used to strand the Agent tab on "Reconnecting…".
- **A CLI login belongs to the machine, not to a TaCos user**: Codex/Pi sign in under the OS account running the server (`~/.codex`, `~/.pi`), so every member of a workspace may spend that subscription — `/api/ai/chat` only requires `requireCli(engine)` and AI being enabled, and `aiEngineOptions` marks the CLI available to all. Do not reintroduce an admin-only gate without a per-workspace switch; the API engine (a provider key) remains the only billing-safe option on an untrusted server.
- **Agent conversations are TaCos records**: every thread is bound to one project and stores its chat *and* its trajectory (`agent_threads` / `agent_messages` / `agent_steps`). `src/lib/agent-threads.ts` owns them; `/api/ai/chat` taps its own SSE stream to persist assistant text and steps, so a closed tab keeps what was already produced. Chat mode runs Codex read-only and refuses writes; Work mode runs it `workspace-write` and routes every TaCos change through the MCP tools. `/agent` renders inside the normal workspace chrome (tab bar + sidebar), and the Agent card itself holds a Codex-style conversation column (project groups + Recents + search, docked above `@[620px]` and behind a `PanelLeft` drawer below it), centered Chat/Work pills, and an empty-state composer that creates the thread and sends the first message via a `sessionStorage` handoff.
- **Work-mode writes ask the user first**: `/api/ai/chat` mints a per-turn grant (`issueAgentToolGrant`) and starts `scripts/agent-mcp.mjs` as a stdio MCP shim; read-only tools are auto-approved, writes surface as `mcpServer/elicitation/request` and wait on `waitForAgentApproval` until the browser answers `/api/ai/chat/approval`. A declined prompt reaches Codex as a failed tool call whose error says the user rejected it — `stepFromItem` renders that as `denied`. The card also offers "Allow for this turn": `/api/ai/chat/approval` sets `autoApproveTurn` on that turn's grant, so later writes in the same turn skip the card (`isTurnApproved` in the bridge) — a new turn starts asking again. `tacos.create_tasks` / `tacos.update_tasks` take up to 20 items in one call so a list of tasks costs one approval instead of one per task; they report per-item success and keep going when one item fails. The shim is part of the standalone payload (`scripts/bundle-server.mjs`); drop it and Work mode starts with no tools.
- **Codex ambient servers still start**: `-c mcp_servers={}` only suppresses the default empty table, so the user's own Codex config and plugins are passed explicitly as `-c mcp_servers.tacos.*` overrides next to `-c plugins={}`. Keep approvals for `tacos.*` inside our own elicitation handler; anything else the model asks for is denied.

## Conventions

- ChatGPT-style light UI: colors/tokens in `src/app/globals.css` (`@theme`), status/priority meta in `src/lib/constants.ts`, shared row/badge glyphs in `src/components/icons.tsx`.
- Errors: throw `TacosError(message, status, hint?)` from lib code; REST maps it to `{error, hint}` JSON, actions catch it and return `{ok:false}`.
- Server actions return `ActionResult<T>` (`{ok:true,data} | {ok:false,error}`), never throw to the client.
