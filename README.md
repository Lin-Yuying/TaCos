<p align="left"><img src="public/brand/otter-line.png" alt="TaCos" width="80"></p> 

# TaCos

A task tracker built for teams that work alongside AI agents. 

TaCos is a fast, local-first tracker where humans and agents share the same backlog. 

- **Teams and workspaces** — multiple workspaces per install, invite codes, roles, avatars, per-workspace API keys.
- **Projects** — markdown overviews, color-coded icons, favorites, task prefixes (`CORE-7`), and a 30-day recycle bin.
- **Tasks** — list and board views, labels, priorities, multiple assignees, comments, and a combined activity timeline.
- **Insights** — on-demand flow metrics, workload, lead/cycle time, delegation and token usage, automation runs, shared reports and CSV export.
- **Agents as teammates** — named workspace agents and a personal agent, task delegation that keeps the human assignee, review (approve / request changes / retry), Inbox notices and filters.
- **Agent runtime** — local harnesses (Codex, Pi, OpenCode, WorkBuddy, dsh), the built-in API agent with no desktop runner, ACP agents, native session resume, token usage, and plan usage where a harness reports it.
- **Agent-first APIs** — scoped Bearer-key REST at `/api/v1/*`, a stdio MCP server, and a stateless Streamable HTTP MCP endpoint at `/api/mcp` for Claude Code / Claude Desktop / Codex.
- **Desktop builds** — a thin shell for an existing server, or a local build that bundles its own server and SQLite database.
- **No migration CLI** — the SQLite schema is created and upgraded idempotently on first use.

Stack: Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS v4 · Drizzle ORM · better-sqlite3 (WAL) · cmdk · Model Context Protocol SDK.

## Quick start 

Requires Node.js 20.9+.

```bash
npm install
npm run dev         
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
| `TACOS_API_AGENT_BASE_URL` / `TACOS_API_AGENT_KEY` / `TACOS_API_AGENT_MODEL` | unset | Server-side model endpoint for the built-in API agent when member keys live on their computers. |
| `TACOS_API_AGENT_MAX_ITERATIONS` | `20` | Internal safety guard for the built-in loop. Not a budget. |
| `TACOS_ACP_BIN` | unset | An ACP-compatible agent command (JSON-RPC over stdio); adds it to the Agent composer. |
| `TACOS_TIMEZONE` | server timezone | IANA zone for Insights day boundaries and its CSV date columns, for example `Asia/Shanghai`. |
| `TACOS_CODEX_SUBSCRIPTION_JSON` | unset | Test/headless Codex plan snapshot; otherwise TaCos reads app-server rate limits. |

Workspaces are created in the app. Joining an existing workspace uses a code such as `TACOS-1A2B3C4D`.

## Production

```bash
npm run build
npm run start
```

Put the app behind a reverse proxy with TLS. If it is reachable from the public internet, restrict access with something like Cloudflare Access or a VPN, change the built-in admin password, and set `TACOS_SEED_DEMO=0`. The SQLite file contains password hashes, session tokens, and hashed API keys; never serve `data/` or commit it.

## Operations

Open **Settings → System** as the instance admin for version, database size and
integrity, free disk, uptime, backup age, runner state and the update channel.
`GET /api/health` returns the same aggregate status as JSON without paths or
secrets (`503` when database integrity fails).

- **Backups**: the daily timer keeps 14 days by default and writes a manifest naming
  the app version, size, hash and integrity result. **Back up now** writes the same
  shape and records the run. Retention is configurable (1–90 days).
- **Restore**: workspace owner only, same app version only. Type `RESTORE`; TaCos
  creates a safety backup, replaces the database, checks integrity, and puts the
  safety backup back if the swap fails. Restart the service afterwards. Uploaded
  files are not replaced.
- **Upgrades**: `deploy/install.sh` requires 1 GB free, takes a verified pre-upgrade
  backup, keeps `app.old`, and checks that `/api/health` reports the new version.
  `sudo /opt/tacos/deploy/rollback.sh` restores the previous app and its
  pre-upgrade backup.
- **Diagnostics**: one capped text bundle with redacted config, schema version,
  the operations log and recent harness logs; no database rows or secrets.
- **Runners**: a read-only view of which computers are online, their harness
  readiness and recent errors; there is no remote runner or tunnel control.

The full procedure, thresholds and screenshot checklist are in
[`docs/runbook-ops.md`](docs/runbook-ops.md).

## Agent tab and delegation

Open **Agent** to chat with a harness, the built-in API agent, or an ACP agent. The
composer picks engine, model and approval (Ask / Auto / Full). Every TaCos write
still goes through the MCP tool path and waits for Allow on Ask; Delete always asks.

A task can be delegated to a named workspace agent or a personal agent from the task
panel. The assignees stay; the run comes back as a comment with a review state
(Approve / Request changes / Retry), a timeline event and an Inbox notice. The run
panel shows whether it ran on the desktop runner or the built-in API agent, the
model, and reported tokens. Usage is observe-only: there is no budget and no USD.

Settings → Agents creates and scopes agents; Settings → Agent usage shows tokens per
agent, model and run. Settings → Harness shows plan usage only where the harness
reports it; the rest say "Not reported".

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

# create a project (a project-scoped key cannot do this)
curl -X POST http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer tac_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Mobile app","description":"iOS and Android"}'

# set custom fields, then make the task wait for another one
curl -X PUT http://localhost:3000/api/v1/issues/CORE-7/fields \
  -H "Authorization: Bearer tac_YOUR_KEY" \
  -H "Content-Type: application/json" -d '{"fields":{"Stage":"beta"}}'
curl -X POST http://localhost:3000/api/v1/issues/CORE-7/dependencies \
  -H "Authorization: Bearer tac_YOUR_KEY" \
  -H "Content-Type: application/json" -d '{"blockedBy":"CORE-3"}'

# create a private document in a project, then comment on it
curl -X POST http://localhost:3000/api/v1/pages \
  -H "Authorization: Bearer tac_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Release checklist","doc":"# Check\n- [ ] Tag","project":"CORE"}'

curl -X POST http://localhost:3000/api/v1/pages/PAGE_ID/comments \
  -H "Authorization: Bearer tac_YOUR_KEY" \
  -H "Content-Type: application/json" -d '{"body":"Added the rollback step"}'
```

| Endpoint | Methods |
| --- | --- |
| `/api/v1/issues` | `GET` (filters: `status`, `priority`, `q`, `label`, `project`, `cursor`, `limit`; page headers `X-Total-Count`, `X-Next-Cursor`), `POST` (accepts `recurrence`) |
| `/api/v1/issues/{id}` | `GET` (includes custom `fields`), `PATCH` (accepts `recurrence`), `DELETE` (soft delete into Trash) — `{id}` accepts a UUID or identifier (`CORE-7`) |
| `/api/v1/issues/{id}/comments` | `GET`, `POST` |
| `/api/v1/issues/{id}/fields` | `PUT` — `{"fields":{"Stage":"beta"}}`, keys are a field name or id, `null` clears one |
| `/api/v1/issues/{id}/dependencies` | `POST` — `{"blockedBy":"CORE-3"}` |
| `/api/v1/issues/{id}/dependencies/{blockedBy}` | `DELETE` |
| `/api/v1/issues/{id}/claim` | `POST` (claim), `DELETE` (release) — acts for the key's person |
| `/api/v1/issues/{id}/review` | `POST` — `{"state":"approved"}` or `{"state":"rejected"}` for a task waiting for review |
| `/api/v1/issues/{id}/blockers` | `POST` — `{"body":"Waiting on the API"}` |
| `/api/v1/issues/{id}/restore` | `POST` — restores a task from Trash by id or identifier |
| `/api/v1/projects` | `GET`, `POST` — a project-scoped key lists only its projects and cannot create one |
| `/api/v1/projects/{id}` | `GET` (members + task counts), `PATCH` (`name`, `description`, `color`, `icon`), `DELETE` (moves the project and its tasks to Trash; creator or owner only) |
| `/api/v1/projects/{id}/members` | `GET`, `POST` — `{"username":"sam"}` or `{"userId":"…"}` |
| `/api/v1/projects/{id}/members/{userId}` | `DELETE` — the project lead cannot be removed |
| `/api/v1/projects/{id}/tasks` | `GET` — same filters and page headers as `/api/v1/issues`, pinned to the project |
| `/api/v1/pages` | `GET` (filters: `project`, `parentId`, `q`, `cursor`, `limit`; page headers `X-Total-Count`, `X-Next-Cursor`), `POST` (`title`, `doc`, `project`, `parentId`) — markdown bodies; pages start private |
| `/api/v1/pages/tree` | `GET` — visible pages in tree order with `depth`; accepts the `project` filter |
| `/api/v1/pages/{id}` | `GET` (markdown body + author), `PATCH` (`title`, `doc`, `icon`, `baseRevision`), `DELETE` (soft delete into Trash; the page author only) |
| `/api/v1/pages/{id}/comments` | `GET` (cursor/limit), `POST` (`body`, optional `parentId` for a reply) |
| `/api/v1/labels` | `GET`, `POST` |
| `/api/v1/me` | `GET` (key name, scopes, project count, expiry, last used time/IP) |
| `/api/mcp` | `POST` (MCP Streamable HTTP, same Bearer key) |

Statuses: `todo`, `in_progress`, `done`, `canceled` (aliases such as `in progress` and `completed` work too). Priorities: `none|low|medium|high|urgent` or `0–4`. Recurrence: `daily`, `weekly`, `monthly`.

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
`list_members`, `get_project`, `create_project`, `update_project`,
`list_project_tasks`, `set_task_fields`, `add_dependency`, `remove_dependency`,
`claim_issue`, `release_issue`, `set_review_state`, `report_blocker`,
`restore_issue`, `list_pages`, `get_page`, `create_page`, `update_page`,
`list_page_comments`, `add_page_comment`. The list tools take `cursor`/`limit`
and return `nextCursor`. Every tool declares MCP annotations; the list/get tools
also declare `outputSchema` and return `structuredContent`.

`claim_issue`, `release_issue`, `set_review_state`, `report_blocker`,
`create_project`, `create_page`, `update_page` and `add_page_comment` need a
person: over HTTP the key's owner is that person, while the local stdio server
has no signed-in user and refuses those writes.
`set_task_fields` takes raw values keyed by field name or id and `null` clears
one. A server limited to a project allowlist can work in those projects but
cannot create a new one; page tools follow the same allowlist, and a page
without a project stays readable. Page visibility follows the web UI: a shared
page is readable by the workspace, a private page only by its author. The stdio
server reads every page in the workspace (it holds the database) but refuses
page writes because it has no person to attribute them to.

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

## Views, bulk edit and templates

- `Views` in the task list saves a personal view by default. Tick **Share with everyone**
  to publish it to the workspace, or create it from a project page to scope it to that
  project. The view owner or a workspace admin can rename, share/unshare, delete and set
  it as the scope default; a default opens automatically, and personal views stay private.
- **Display** (or `Shift V`) sets layout, grouping, ordering, sub-issues, empty groups and
  visible properties per view. A member opening a shared view keeps a personal display
  override until they reset it; the owner or an admin saves the shared display.
- The bell on a shared view subscribes you to its Inbox notifications: a task added to
  the view and a task completed or canceled inside it. Your own actions never notify you.
  Mute or unsubscribe from the same menu; Inbox settings include a **View subscriptions**
  group. Delivery is the Inbox only.
- **Select tasks** on the list, board or table opens the bulk bar: status, assignee,
  priority, labels, due date and project. Each task is applied on its own, so the result
  reports per-task errors; changing status still needs the task's assignee.
- **Template** in the new-task composer fills a saved title, description, priority, labels
  and custom fields. Templates are workspace-level; the owner or an admin curates them.
- Tasks carry a numeric `estimate` (nullable). The task panel and composer edit it, and
  the REST/MCP task fields accept it for planning work.

## Collaboration: comments, follow and Activity

- **Task comments** thread one level: a reply quotes its parent instead of indenting
  forever. Authors can edit, delete and restore their own comments; the task creator can
  delete any comment. Edit and delete are recorded in the task's changelog. Each thread
  can be resolved and reopened, and comments take one of five fixed reactions. Comments
  stay Markdown, and the composer is still the two-line `@` box with Cmd/Ctrl+Enter.
- **Follow / Unfollow** works on a task, project or document. Creators, assignees, people
  mentioned and people who comment follow automatically; the watcher menu lists everyone
  following and why. **Mute notifications** keeps the follow but stops comment notices;
  an explicit `@mention` still arrives. Existing creator/assignee audiences are migrated
  into the watcher set once, so unsubscribing is not undone by the next server start.
- **Inbox dedupe**: one comment produces at most one Inbox row per person, whether they
  follow, are mentioned or are being replied to. The actor never receives a notice about
  their own action. Mutes from **Inbox → settings** still apply.
- **Activity** (`/activity`, sidebar under Inbox) is the read-only workspace timeline:
  task, document and project changes, newest first, with **All / My activity /
  Following** scopes and object type, project and person filters. It obeys task/project
  and document visibility, paginates with keyset cursors, and links every row back to its
  task, document or project. It is deliberately separate from the Inbox: Activity says
  what happened, Inbox says what needs you.
- **Review threads** reuse task comments. **Request changes** and **Approve** post one
  marked comment, move the task's review state, land in the changelog and send an Inbox
  review notice to the publisher. Approval of an agent-published task clears its review
  gate; Request changes keeps a pending task in the review queue. The review queue links
  to the task's thread and to its newest review comment.

Checks: `check-task-comments.ts`, `check-watchers.ts`, `check-activity-feed.ts` and
`check-review-threads.ts` run under `npm run check:harness`.

## Planning: cycles, milestones and initiatives

**Planning** (`/planning`, one sidebar row with three tabs) is the planning layer. It is
deliberately small: no custom planning fields, no forecast, no drag scheduling.

- **Cycles** are workspace time boxes, because TaCos has no team layer yet. Settings ›
  Cycles sets the length (1–8 weeks), the start weekday, a cooldown, how many upcoming
  cycles to keep scheduled and whether active unplanned tasks join the current cycle
  (opt-in, off by default). The schedule is filled lazily when someone opens Planning or
  saves the settings; there is no background job. A cycle's page shows its progress, a
  simple burndown, the committed estimates and a capacity figure averaged from the last
  three completed cycles (points when every task was sized, otherwise task count).
- **Rollover** runs once per completed cycle and moves only `todo` and `in_progress`
  tasks to the next cycle; `done` and `canceled` never move. The conditional status
  update and each task's conditional `cycle_id` update make a restart or two concurrent
  ticks harmless: no duplicate cycles, moves or changelog rows. A successor cycle is
  created on demand even when automatic creation is off, so work is never stranded.
- **Milestones** belong to a project (project Timeline tab): name, description, optional
  target date and plan order. Progress counts their tasks, the first unfinished stage is
  marked **Current**, and the tab groups and filters tasks by milestone. A task can only
  take a milestone from its own project; deleting a milestone keeps its tasks.
- **Initiatives** group projects under one objective with status, priority, owner,
  target date, labels, resources and a project set. Progress rolls up from the tasks of
  the linked projects; the tab filters by status, owner and text.
- **Roadmap** is list/timeline only: milestones by month or quarter, grouped by
  initiative, with projects that belong to no initiative still listed. Dates change by
  editing a milestone, not by dragging.
- An optional `.ics` download for a cycle lives beside the cycle date range; there is no
  calendar sync or feed token.

Checks: `check-cycles.ts`, `check-milestones.ts`, `check-initiatives.ts` and
`check-planning-rollover.ts` run under `npm run check:harness`.

## Insights: flow, workload and agent usage

**Insights** (`/insights`, one sidebar row) is a read-only report over the tasks the
viewer can already see. Everything is aggregated on demand from the existing tables;
there is no snapshot table, warehouse, query builder or custom formula. A range wider
than one year is clamped. Sections can be empty while the workspace is young: that is a
real state, not an error.

- **Dataset and filters.** Project visibility, the workspace task-visibility switch and
  the Trash rules are the ones the task lists use. Sub-tasks are counted as separate
  tasks. Deleted tasks, tasks in deleted projects and rejected agent drafts never enter a
  report. Filters are project, assignee (assigned or claimed), label and status; the date
  range is applied to flow events, and every chart and panel is recomputed from the same
  dataset, so the project panel and the workspace totals agree.
- **Definitions.** Created / completed / canceled are transitions inside the range.
  **Lead time** runs from creation to the latest Done; **cycle time** runs from the first
  In Progress (or creation when the task starts in progress) to Done. **WIP** is the
  status at the end of the range. Canceled tasks are counted separately and left out of
  all three time measures. **Review latency** runs from an agent review request to the
  next approval; an agent-published task falls back to its creation when the request is
  the publish gate. Subtasks are separate. A task completed before status events were
  recorded uses its last update time and the page says the history is partial.
- **Time and timezone.** Day boundaries use `TACOS_TIMEZONE` (otherwise the server's
  zone) and the page shows the zone it used. Weeks start on Monday; the burn-up seeds the
  cumulative lines from tasks that existed before the range.
- **Panels.** Throughput bars, a lead/cycle scatter plot and a burn-up chart are
  accessible SVG with text summaries and no chart dependency. Workload by assignee,
  project roll-up, cycle and milestone progress reuse the planning and task records. The
  Agent panel shows delegation coverage, runs, reported input/output/cached/reasoning
  tokens by agent and model; usage stays observe-only and never shows a price or budget.
  The Automation panel shows run outcomes, failures and duration; members see the runs
  they triggered, while workspace admins see every run.
- **Sharing and export.** Save the current dates and filters as a shared workspace view
  (the same view table and permissions as task views — members only, no guests), copy a
  link to the report, or export the current table as UTF-8 CSV. The CSV is built from the
  same rows the table renders and applies the same visibility checks.

Checks: `check-insights-metrics.ts` (a hand-computed fixture covering definitions,
filters and timezone boundaries) and `check-insights-export.ts` (CSV shape, project access,
shared report links) run under `npm run check:harness`.

## Documents, links and page templates

- Type `[[` in a document to open the page picker; **Link a page** does the same from the
  toolbar. The stored reference is `[[title|page-id]]`, and the title is read from the
  page when the document renders, so renaming a target does not break the link.
- A target page's **Linked from** panel lists the pages that point at it. It follows the
  existing page visibility: a private page's references stay private. A target in the
  Trash renders as an unresolved, dashed mention and disappears from backlinks; restoring
  the page resolves it again. Links are rebuilt from the page text on every save, so
  version restore and live collaboration need no separate link bookkeeping.
- **Settings → Page templates** lets the workspace owner or an admin save a title and
  Markdown body. **New document** in the document tree, document index or project
  Documents can start from one. Available variables are `{date}`, `{author}` and
  `{project}`; `{project}` is empty outside a project, and unknown placeholders stay as
  written. The page and its first version record which template it came from, and deleting
  a template changes nothing for pages already created.
- The reader's **Outline** panel lists the document's headings; the `#` beside a heading
  (or the copy button in the outline) copies a link that opens the document at that
  heading. Heading ids are stable for duplicates and Chinese headings, and `[[` inside
  code blocks or inline code is text, not a link.
- Page history stays at 200 versions per page.

## Automations (internal only)

**Settings → Automations** lets the workspace owner or an admin build rules from three
templates or from scratch. A rule is a trigger, optional conditions and an ordered list of
actions. Members see the enabled rules and the runs their own actions triggered; agents,
the REST API and MCP have no rule-creation surface.

- Triggers: task created, status changed, assigned, claimed, released, delegated to an
  agent, due soon, comment added, mention, agent run finished or failed, document updated.
  A document save fires at most once per document in five minutes, so typing does not
  spam the rule. Due soon means exactly N days before the due date (1, 2, 3, 5 or 7 in the
  UI), checked by one in-process interval; `TACOS_DISABLE_AUTOMATIONS=1` turns it off.
- Conditions: project, label, priority, assignee presence, status and text contains.
  Every condition must pass. A rule never re-triggers on an event caused by its own
  actions, and two rules that call each other stop after three action levels.
- Actions run in order: set status, set assignees, set labels, add comment, notify people,
  delegate to a shared workspace agent, create a document or create a task. A failure is
  recorded and later actions still run. SQLite failures retry up to three times; a settled
  business error does not.
- Each (rule, event) runs at most once, so a scheduler restart or a retried dispatch
  cannot duplicate a comment or a delegation. The run log shows the trigger, each action's
  result, the duration and any error; **Rule changes** keeps an audit of edits, toggles and
  deletions.
- **Dry run** evaluates the saved rule against a task identifier or its last matching
  event and previews the actions without writing anything.
- Delegation actions reuse the #79 run and review path: the human assignees stay, the run
  reports back as a review, and the Inbox notices are the same. This feature has no Slack,
  GitHub, webhook, email, push or external-agent delivery.

## Export, import and portability

**Settings → Export** and **Settings → Import** are owner/admin actions. An export is one
canonical ZIP: `workspace.json`, `manifest.json`, `tasks.csv`, `docs/<page>.md` with the
page tree as folders, and `attachments/` with original bytes and a manifest. Passwords,
API key hashes/plaintext, provider keys, runner tokens, sessions and join codes are never
written; API keys export only their name, scopes and project allowlist. The export runs
in the server process with live progress and a signed download URL valid for 15 minutes;
`npm run export -- <workspace>` writes the same archive on the server. See
[the export/import runbook](docs/runbook-import-export.md).

Import accepts a TaCos export, a Notion Markdown export ZIP, a Markdown folder or a task
CSV. It previews counts, conflicts and unmapped fields before writing anything, then
builds a **new** workspace in the background. The workspace stays hidden until the last
row lands; a failure rolls it back completely. Re-running the same import returns the
first workspace instead of creating duplicates. Attachments are on by default with a
size cap and can be turned off. There is no import REST API in v1: the Settings UI and
`npm run import -- <file>` are the entry points.

Checks: `check-export-roundtrip.ts`, `check-export-secrets.ts`,
`check-import-markdown.ts` and `check-import-csv.ts` run under `npm run check:harness`.

## Search

- `/` opens the full search page and focuses its query bar; `Cmd/Ctrl K` opens the
  command palette. The sidebar has one **Search** row, and the two surfaces run the
  same server search, so a query returns the same hits in both. Focused text fields
  keep their own `/`; no existing shortcut is rebound.
- The index covers tasks and their comments, documents and their comments, projects,
  people, labels, Agent threads (title plus the latest assistant reply), attachment
  names and automation rules. A deleted task, trashed project/document/comment,
  unfinished agent draft and private thread are not results. The existing project,
  page and agent-thread visibility rules decide what each member sees; there is no
  guest access.
- The search page has kind tabs with live counts, one filter row (project, assignee,
  status, created, updated), sorting by best match/updated/created, grouped results
  and pagination. A task or document opens in the existing side panel while the
  query, filters, scroll position and URL stay put; projects, people, labels, Agent
  threads, files and rules link to their own surfaces. Recent searches and recently
  opened results are kept in this browser per person and workspace.
- The palette keeps results in entity groups and commands in their own groups.
  Prefixes `i`, `p`, `u`, `d`, `a` and `f` scope to tasks, projects, people,
  documents, Agent and attachments; `@me`, `@none` and `@<status>` add filters. The
  prefix and filter chips are clickable and removable, so the syntax is optional.
  Commands still include New task and the existing navigation.
- Search is FTS5 with the trigram tokenizer plus a LIKE fallback for one- and
  two-character terms (most Chinese words); there is no per-language tokenizer and no
  external or vector index. Snippets come from the matching body and the client
  highlights the query.
- Performance: `npx tsx scripts/check-search-filters.ts` seeds 10,000 tasks and 1,000
  documents and asserts a filtered search stays under 300 ms of server time.
  `npx tsx scripts/check-search-coverage.ts` exercises every entity and permission
  boundary. Both run inside `npm run check:harness`.
- Saved searches in this release are the personal recent list only. U-09 shared views
  stay the shared saved-view mechanism.

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

## **Why the name TaCos?**
- Well, I like tacos 🌮, one of my favorite Mexican foods,
- Ta stands for “獭” (otter) 🦦 in Chinese, the cutest animals in the world,
- Co, abbreviation of “collaboration”.

And that's why TaCos' icon features a little otter gazing up at the starry sky.


## License

[MIT](LICENSE) © 2026 Zhenglin Chen, Yongqi Liu, Jiahao Xu, Xinyue Zhang and Yuying Lin. 

