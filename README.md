<p align="right"><img src="public/brand/otter-line.png" alt="Tacos" width="80"></p>

# Tacos

A self-hosted, Linear-style issue tracker built for teams that work alongside AI agents.

Tacos is not another chatbot wrapper. It is a fast, local-first tracker where humans and agents share the same backlog: people work in the web UI, agents plug in over a REST API or MCP, and every change is attributed to whoever made it.

- **Teams and workspaces** — multiple workspaces per install, invite codes, roles, avatars, per-workspace API keys.
- **Projects** — markdown overviews, color-coded icons, favorites, issue prefixes (`CORE-7`), and a 30-day recycle bin.
- **Issues** — list and board views, labels, priorities, multiple assignees, comments, and a combined activity timeline.
- **Agent-first APIs** — Bearer-key REST at `/api/v1/*` plus a stdio MCP server for Claude Code / Claude Desktop.
- **Desktop builds** — a thin Electron shell for an existing server, or a local build that bundles its own server and SQLite database.
- **No migration CLI** — the SQLite schema is created and upgraded idempotently on first use.

Stack: Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS v4 · Drizzle ORM · better-sqlite3 (WAL) · cmdk · Model Context Protocol SDK.

## Quick start

Requires Node.js 20.9+.

```bash
npm install
npm run dev          # http://localhost:3000
```

The database lives at `data/tacos.db` and is created on first run.

On a fresh database Tacos seeds a demo workspace so there is something to click around:

| Account | Password | Role |
| --- | --- | --- |
| `alex` | `password123` | workspace admin (demo) |
| `sam` | `password123` | workspace member (demo) |
| `admin` | `admin123` | site super-admin (`/admin`) |

Set `TACOS_ADMIN_PASSWORD` before the first start to give the built-in admin a different password, and set `TACOS_SEED_DEMO=0` if you do not want demo users or issues.

> The demo accounts and the default admin password are development conveniences. Do not expose an instance with these credentials to a network you do not control.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TACOS_DATA_DIR` | `data/` | Directory that holds `tacos.db` (and its WAL files). |
| `TACOS_SEED_DEMO` | `1` | Set to `0` to skip the demo workspace, users, and issues. |
| `TACOS_ADMIN_PASSWORD` | `admin123` | Password for the built-in `admin` account, applied only when it is first created. |
| `TACOS_WORKSPACE_KEY` | `HQ` | Workspace key used by the MCP server. |
| `PORT` / `HOSTNAME` | `3000` / all interfaces | Standard Next.js server bindings. |

Workspaces are created in the app. Joining an existing workspace uses a code such as `TACOS-1A2B3C4D`.

## Production

```bash
npm run build
npm run start
```

Put the app behind a reverse proxy with TLS. If it is reachable from the public internet, restrict access with something like Cloudflare Access or a VPN, change the built-in admin password, and set `TACOS_SEED_DEMO=0`. The SQLite file contains password hashes, session tokens, and hashed API keys; never serve `data/` or commit it.

## Agent REST API

Create a key in **Settings → Agent access**, then:

```bash
# list active issues
curl -H "Authorization: Bearer tac_YOUR_KEY" \
  "http://localhost:3000/api/v1/issues?status=active&q=login"

# create an issue (labels auto-create; status and priority accept friendly aliases)
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
| `/api/v1/issues` | `GET` (filters: `status`, `priority`, `q`, `label`, `limit`), `POST` |
| `/api/v1/issues/{id}` | `GET`, `PATCH`, `DELETE` — `{id}` accepts a UUID or identifier (`CORE-7`) |
| `/api/v1/issues/{id}/comments` | `GET`, `POST` |
| `/api/v1/labels` | `GET`, `POST` |
| `/api/v1/me` | `GET` (key introspection) |

Statuses: `todo`, `in_progress`, `done`, `canceled` (aliases such as `in progress` and `completed` work too). Priorities: `none|low|medium|high|urgent` or `0–4`.

## MCP server (Claude Code / Claude Desktop)

The MCP server reads the same SQLite database directly, so it works even when the web server is not running.

Tools: `list_projects`, `list_members`, `list_issues`, `get_issue`, `create_issue`, `update_issue`, `delete_issue`, `add_comment`, `list_labels`, `create_label`.

Claude Code:

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

Smoke-test the server end-to-end (create → update → comment → get → delete):

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

Desktop binaries are not code-signed. On Windows 11, Smart App Control blocks unsigned installers outright (there is no per-app override); use a signed build, the browser UI, or a machine where Smart App Control is off.

## How it fits together

```
src/lib/issues.ts      business logic and validation (shared by web UI, REST, MCP)
src/lib/constants.ts   client-safe constants and types (no DB imports)
src/db/                Drizzle schema, SQLite client (WAL, auto-migrate, demo seed)
src/app/api/v1/        agent REST surface (Bearer keys, SHA-256 hashed at rest)
src/app/api/internal/  read-only helpers for the web UI
src/app/actions.ts     server actions for the web UI (actor "you")
mcp/server.ts          stdio MCP server → same library, actor "mcp"
electron/              thin desktop shell and bundled-server launcher
```

Every mutation records an event with an actor (`you`, `api:<key-name>`, or `mcp`). The issue panel merges comments and events into one timeline, so the history stays readable whether a human or an agent made the change.

## License

[MIT](LICENSE) © 2026 Yuying Lin. The Tacos name and otter artwork are project branding; the license covers the source code.
