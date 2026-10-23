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
- **Status changes are owned**: only the issue's creator or one of its assignees may change status; agent callers (API keys/MCP) stay unrestricted so automation keeps working. Assignments are many-to-many in `issue_assignees` and updated as a full set (`assigneeIds`). Enforce both in `src/lib/issues.ts`.
- **Deletion rights are personal, not admin-inherited**: only `project.createdBy` may trash/purge a project, and only `workspaces.created_by` (the owner, backfilled to the first admin on old rows) may delete a workspace. Invited members get "Leave workspace" in the sidebar switcher. Put these checks in `src/lib/issues.ts`, not only in the UI.
- **Workspace deletion is a 30-day recycle bin, not a hard delete**: the owner must type `confirmed` (enforced in lib, not just the dialog), `workspaces.deleted_at` hides the team from every list and from `requireWorkspace`/API keys, every other member gets a `workspace_deleted` notification (shown in whatever Inbox they still have, or on `/onboarding`), and `restoreWorkspace` clears the flag within the window. `purgeExpiredWorkspaces` is a lazy sweep run when the bin is opened — there is no background job.
- **Actor attribution matters**: every mutation takes `{ actor, via }` (`you` / `api:<key-name>` / `mcp`). The UI renders this in timelines and badges. New mutations must record events.
- `src/lib/constants.ts` is the only issues-adjacent module client components may import values from (it has no DB imports). Importing values from `src/lib/issues.ts` in a client component would drag better-sqlite3 into the browser bundle. Type-only imports from issues.ts are fine.
- `better-sqlite3` must stay in `serverExternalPackages` (next.config.ts).
- With Cache Components enabled (Next 16): any component reading the DB must `await connection()` (from `next/server`) first and sit inside a `<Suspense>` boundary, because SQLite reads are synchronous and would otherwise be baked into the static shell at build time.
- Issue identifiers are allocated atomically via `INSERT ... SELECT COALESCE(MAX(number),0)+1`; the identifier column is backfilled immediately after. Don't precompute numbers client-side.

## Conventions

- ChatGPT-style light UI: colors/tokens in `src/app/globals.css` (`@theme`), status/priority meta in `src/lib/constants.ts`, shared row/badge glyphs in `src/components/icons.tsx`.
- Errors: throw `TacosError(message, status, hint?)` from lib code; REST maps it to `{error, hint}` JSON, actions catch it and return `{ok:false}`.
- Server actions return `ActionResult<T>` (`{ok:true,data} | {ok:false,error}`), never throw to the client.
