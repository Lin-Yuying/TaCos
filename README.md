<p align="left"><img src="public/brand/otter-line.png" alt="TaCos" width="80"></p> 

# TaCos

A task tracker built for teams that work alongside AI agents. 

TaCos is a fast, local-first tracker where humans and agents share the same backlog. 

- **Teams and workspaces** — multiple workspaces per install, invite codes, roles, avatars, per-workspace API keys.
- **Projects** — markdown overviews, color-coded icons, favorites, task prefixes (`CORE-7`), and a 30-day recycle bin.
- **Tasks** — list and board views, labels, priorities, multiple assignees, comments, and a combined activity timeline.
- **Agent-first APIs** — scoped Bearer-key REST at `/api/v1/*`, a stdio MCP server, and a stateless Streamable HTTP MCP endpoint at `/api/mcp` for Claude Code / Claude Desktop / Codex.
- **Desktop builds** — a thin shell for an existing server, or a local build that bundles its own server and SQLite database.
- **No migration CLI** — the SQLite schema is created and upgraded idempotently on first use.

Stack: Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS v4 · Drizzle ORM · better-sqlite3 (WAL) · cmdk · Model Context Protocol SDK.

## Quick start 

Requires Node.js 20.9+.

```bash
npm install
npm run dev          # http://localhost:3000
```

The database lives at `data/tacos.db` and is created on first run.

On a fresh database TaCos seeds a demo workspace so there is something to click around:

| Account | Password | Role |
| --- | --- | --- |
| `admin` | `admin123` | site super-admin (`/admin`) |

Set `TACOS_ADMIN_PASSWORD` before the first start to give the built-in admin a different password, and set `TACOS_SEED_DEMO=0` if you do not want demo users or tasks.

> The demo accounts and the default admin password are development conveniences. Do not expose an instance with these credentials to a network you do not control.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TACOS_DATA_DIR` | `data/` | Directory that holds `tacos.db` (and its WAL files). |
| `TACOS_SEED_DEMO` | `1` | Set to `0` to skip the demo workspace, users, and tasks. |
| `TACOS_ADMIN_PASSWORD` | `admin123` | Password for the built-in `admin` account, applied only when it is first created. |
| `TACOS_WORKSPACE_KEY` | `HQ` | Workspace key used by the stdio MCP server. |
| `TACOS_MCP_READ_ONLY` | off | `1` hides every write tool on the stdio MCP server. |
| `TACOS_MCP_TOOLS` | all | Comma-separated tool names the stdio MCP server may register. |
| `PORT` / `HOSTNAME` | `3000` / all interfaces | Standard Next.js server bindings. |

Workspaces are created in the app. Joining an existing workspace uses a code such as `TACOS-1A2B3C4D`.

## Production

```bash
npm run build
npm run start
```

Put the app behind a reverse proxy with TLS. If it is reachable from the public internet, restrict access with something like Cloudflare Access or a VPN, change the built-in admin password, and set `TACOS_SEED_DEMO=0`. The SQLite file contains password hashes, session tokens, and hashed API keys; never serve `data/` or commit it.

## Agent REST API

Create a key in **Settings → Advanced → Agent access**. A key belongs to the
workspace and to the person who created it, and leaves with them. Pick:

- **Scope** — `read` for GET requests, or `read` + `write` for create, update,
  delete and comments. A write-only key is not offered; write implies read.
- **Projects** — all projects (default), or an allowlist. A scoped key sees only
  those projects in lists and gets `403` for any other project.
- **Expiry** — 30, 90 (default) or 365 days. A workspace owner or admin may pick
  "Never expires". Keys created before scopes existed keep full access and no
  expiry.

Rate limits are per key: 120 reads/minute and 60 writes/minute, burst 20. Over the
limit the API returns `429` with `Retry-After`. Rotating a key shows the
replacement once and revokes the old key immediately.

```bash
# list active tasks
curl -H "Authorization: Bearer tac_YOUR_KEY" \
  "http://localhost:3000/api/v1/issues?status=active&q=login"

# create a task (labels auto-create; status and priority accept friendly aliases)
curl -X POST http://localhost:3000/api/v1/issues \
  -H "Authorization: Bearer tac_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Fix login redirect","priority":"high","labels":["Bug"],"status":"todo"}'

# update by identifier
curl -X PATCH http://localhost:3000/api/v1/issues/CORE-7 \
  -H "Authorization: Bearer tac_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'

# comment, then delete (soft delete into the workspace trash)
curl -X POST http://localhost:3000/api/v1/issues/CORE-7/comments \
  -H "Authorization: Bearer tac_YOUR_KEY" \
  -H "Content-Type: application/json" -d '{"body":"Shipped in v1.2"}'
```

| Endpoint | Methods |
| --- | --- |
| `/api/v1/issues` | `GET` (filters: `status`, `priority`, `q`, `label`, `project`, `cursor`, `limit`; page headers `X-Total-Count`, `X-Next-Cursor`), `POST` |
| `/api/v1/issues/{id}` | `GET`, `PATCH`, `DELETE` — `{id}` accepts a UUID or identifier (`CORE-7`) |
| `/api/v1/issues/{id}/comments` | `GET`, `POST` |
| `/api/v1/labels` | `GET`, `POST` |
| `/api/v1/me` | `GET` (key name, scopes, project count, expiry, last used time/IP) |
| `/api/mcp` | `POST` (MCP Streamable HTTP, same Bearer key) |

Statuses: `todo`, `in_progress`, `done`, `canceled` (aliases such as `in progress` and `completed` work too). Priorities: `none|low|medium|high|urgent` or `0–4`.

## MCP server (Claude Code / Claude Desktop / Codex)

Two transports share one tool implementation:

- **stdio** for a local checkout. It reads the same SQLite database directly, so
  it works even when the web server is not running.
- **Streamable HTTP** at `/api/mcp` for a deployed server. It is stateless: every
  request carries `Authorization: Bearer tac_…`, and the key's scope, project
  allowlist and rate limits apply to each tool call. Writes are attributed to
  `api:<key name>` via `mcp`.

Tools: `list_issues`, `get_issue`, `create_issue`, `update_issue`,
`delete_issue`, `add_comment`, `list_labels`, `create_label`, `list_projects`,
`list_members`. The list tools take `cursor`/`limit` and return `nextCursor`.
Every tool declares MCP annotations; the list/get tools also declare
`outputSchema` and return `structuredContent`.

Remote (Claude Code):

```bash
claude mcp add --transport http tacos https://your-tacos-host/api/mcp \
  --header "Authorization: Bearer tac_YOUR_KEY"
```

Local (Claude Code):

```bash
claude mcp add tacos -- npx tsx /absolute/path/to/tacos/mcp/server.ts
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tacos": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/tacos/mcp/server.ts"],
      "env": { "TACOS_WORKSPACE_KEY": "HQ" }
    }
  }
}
```

`TACOS_MCP_READ_ONLY=1` hides every write tool on the stdio server, and
`TACOS_MCP_TOOLS=list_issues,get_issue` registers only the named tools. A
read-scoped API key does the same over HTTP; a write call returns a tool error
naming the missing `write` scope.

Smoke-test the stdio server end-to-end (create → update → comment → get →
pagination → delete, then read-only and tool filters):

```bash
npm run mcp:test
```

## Desktop builds

| Command | Output |
| --- | --- |
| `npm run desktop` | Runs the thin Electron shell against a server URL you enter. |
| `npm run desktop:dist` | macOS DMG of the thin shell (`release/`). |
| `npm run desktop:standalone:mac` | macOS DMG with an embedded server and its own SQLite database (`release-standalone/`). |
| `npm run desktop:standalone:win` | Windows x64 installer of the same local build. |

The local desktop build listens on loopback only and stores its data under the OS app-data directory. Build the flavour you plan to ship last: `desktop:standalone:*` rewrites the bundled server payload for its target platform, and the bundler refuses to package a database from the checkout.

Desktop binaries are not code-signed. On Windows 11, Smart App Control blocks unsigned installers outright (there is no per-app override); use a signed build, the browser UI, or a machine where Smart App Control is off. Releases built by GitHub Actions can be signed with SignPath Foundation — see [docs/windows-signing.md](docs/windows-signing.md) for the setup.

## How it fits together

```
src/lib/issues.ts     business logic and validation (shared by web UI, REST, MCP)
src/lib/constants.ts   client-safe constants and types (no DB imports)
src/db/                Drizzle schema, SQLite client (WAL, auto-migrate, demo seed)
src/app/api/v1/        agent REST surface (scoped Bearer keys, SHA-256 hashed at rest)
src/app/api/mcp/       stateless Streamable HTTP MCP endpoint (same API keys)
src/app/api/internal/  read-only helpers for the web UI
src/app/actions.ts     server actions for the web UI (actor "you")
mcp/create-server.ts   MCP tools → same library; mcp/server.ts is the stdio wrapper
electron/              thin desktop shell and bundled-server launcher
```

Every mutation records an event with an actor (`you`, `api:<key-name>`, or `mcp`). The task panel merges comments and events into one timeline, so the history stays readable whether a human or an agent made the change.

## License

[MIT](LICENSE) © 2026 Zhenglin Chen, Yongqi Liu, Jiahao Xu, Xinyue Zhang and Yuying Lin. 
