# U-13: External API / MCP surface expansion

Status: plan added to the roadmap on 2026-11-06 after reviewing what the
external REST API and MCP tools actually cover. No implementation started.
This is a separate area from #77 (Agent access: scopes, expiry, remote MCP
transport) — #77 changes the door, U-13 opens more rooms.

## Why

External programs and AI clients can currently operate only the core task
surface. They cannot create projects, work with documents, manage attachments,
read notifications, change custom fields, or use the richer document tools the
in-app Agent already has. That makes TaCos hard to automate fully from outside
and makes the external Agent surface inconsistent with the internal one.

The product pitch is "humans and agents share the same backlog"; today that is
true for tasks, not for the rest of the workspace.

## Current implementation

REST `/api/v1/*`:

- `GET/POST /issues` — list with filters/cursor and create with title,
  description, status, priority, assignees, labels, dueDate, reminder, project,
  parent.
- `GET/PATCH/DELETE /issues/{id}` — detail/update/soft delete; no restore.
- `GET/POST /issues/{id}/comments` — list/add; no edit/delete.
- `GET/POST /labels` — list/create; no update/delete.
- `GET /me` — key introspection plus project/member lists.
- No project CRUD, no documents/pages, no attachments, no custom fields,
  dependencies, recurrence, blockers, claims, review changes, notifications,
  views, search, agent threads, workspace/member management or webhooks.

MCP (`mcp/server.ts`, 10 tools):

- `list_issues`, `get_issue`, `create_issue`, `update_issue`, `delete_issue`,
  `add_comment`, `list_labels`, `create_label`, `list_projects`,
  `list_members`.
- Same limitations; no documents/pages even though the in-app Agent shim
  exposes `create_doc`/`get_doc`/`edit_doc`/`update_overview`.

The in-app Agent (`scripts/agent-mcp.mjs` + `AGENT_TOOLS`) has a richer tool set
because it runs with a per-turn grant and a project-bound context. External
clients have no equivalent.

## Researched best practice

- Linear API: a single GraphQL schema covers issues, projects, cycles, labels,
  comments, documents and more; scoped tokens and webhooks.
  https://linear.app/developers
- Notion API: pages, databases, blocks, comments and user capabilities; the
  connection's capabilities define what it may read/update/insert.
  https://developers.notion.com/
- GitHub REST/GraphQL: issues, PRs, projects, comments, labels and webhooks;
  fine-grained tokens limit resources and permissions.
  https://docs.github.com/en/rest
- Asana API: tasks, projects, sections, stories and webhooks, with app-level
  scopes. https://developers.asana.com/docs
- MCP best practice from #77: read/write scope, project scoping, tool
  annotations, pagination, output schemas, server-side validation.

Common pattern: the API mirrors the product's core objects, permissions are
scopes on the token, and every write is attributable and auditable.

## Comparison

| Capability | TaCos REST today | TaCos MCP today | Linear API | Notion API | GitHub REST |
| --- | --- | --- | --- | --- | --- |
| Tasks/issues CRUD | Yes | Yes | Yes | Databases/pages | Issues |
| Projects CRUD | No (read list only) | No (read list only) | Yes | Databases | Projects (GraphQL/REST) |
| Documents/pages | No | No | Documents | Pages/blocks | No (wiki separate) |
| Comments | Add/list | Add only | Yes | Yes | Yes |
| Labels | Create/list | Create/list | Yes | Options | Labels |
| Attachments | No | No | Files | Files/blocks | No |
| Custom fields | No | No | Estimates/custom | Properties | Custom fields |
| Dependencies/relations | No | No | Yes | Relations | Sub-issues |
| Recurrence/reminders | Create/update due date only | Same | Recurrence | Reminders | — |
| Claims/review/blockers | No | No | Workflow states | — | Reviews |
| Notifications/Inbox | No | No | Notifications | Comments | Notifications |
| Search | Task `q` only | Task `q` only | Full search | Search | Search |
| Webhooks/events | No | No | Yes | Yes | Yes |
| Scopes / project limits | Planned #77 | Planned #77 | OAuth scopes | Capabilities | Fine-grained tokens |

## Gaps, in priority order

1. **Projects are read-only.** External agents cannot create a project, rename
   it, change its lead/description or manage members.
2. **Documents are invisible externally.** No page list/read/create/edit,
   comments or sharing; the in-app Agent can do more than the external MCP.
3. **Task extensions missing.** Custom task fields, dependencies, recurrence,
   blockers, claims, review-state changes and trash restore are not exposed.
4. **Attachments missing.** No upload/list/download through either surface.
5. **No notification surface.** External agents cannot read or mark the Inbox
   (useful for "what happened since my last run").
6. **No search/views.** Only a task list `q`; no cross-entity search or saved
   views.
7. **No webhook/event subscription.** External automation must poll; #80 adds
   webhooks for automations, not for API consumers.
8. **Inconsistency with the in-app Agent.** Internal tools expose documents and
   overviews; external MCP does not.
9. **No API versioning/changelog.** Adding surface later needs a compatibility
   story.

## Candidate scope (recommended split into two PRs)

This is too large for one PR. Plan U-13 as two implementation PRs, both under
the same plan.

### U-13a — Projects and task completeness (first PR)

- REST: `GET/POST /projects`, `GET/PATCH/DELETE /projects/{id}`, project member
  list/add/remove; `GET /projects/{id}/tasks` convenience.
- REST task additions: custom field values, dependencies add/remove,
  recurrence, claim/release, review-state changes, blockers, restore from
  trash.
- MCP: matching tools (`list_projects` already; add `get_project`,
  `create_project`, `update_project`, `list_project_tasks`, `set_task_fields`,
  `add_dependency`, `remove_dependency`, `claim_issue`, `release_issue`,
  `set_review_state`, `report_blocker`, `restore_issue`).
- Permissions: all new endpoints use #77 scopes/project allowlist; writes
  attribute to `api:<key name>`/`mcp` actor and respect project visibility.
- Annotations/pagination/output schemas for every new MCP tool.

### U-13b — Documents and pages (second PR)

- REST: `GET/POST /pages`, `GET/PATCH/DELETE /pages/{id}`, page tree, page
  comments list/add. Page sharing/access changes stay out of scope; the API
  reads the existing workspace-internal sharing state but does not change it.
- MCP tools mirroring the in-app Agent: `list_pages`, `get_page`,
  `create_page`, `update_page`, `list_page_comments`, `add_page_comment`,
  optionally `search_pages`.
- Permissions: read-only keys cannot create/edit; guests/private-page rules
  follow the existing workspace-internal page visibility rules. Sharing changes are out of scope.
- Drafting/publishing or block-level editing stays out; markdown content only.

### Later (recorded, not planned as PRs yet)

- Attachments upload/download.
- Notification/Inbox read + mark-read endpoints.
- Cross-entity search API.
- API webhooks/event subscription (distinct from #80 automation webhooks).
- API docs page/OpenAPI description and versioning policy.

## Acceptance criteria

1. External clients can list/read/create/update/delete projects and change
   project membership; project visibility rules apply to API/MCP results.
2. Task custom fields, dependencies, recurrence, claims, review changes,
   blockers and restore are available through REST and matching MCP tools.
3. Pages can be listed/read/created/edited and page comments added, with the
   same access model as the web UI; in-app and external document tools no
   longer diverge for the covered operations.
4. Every new MCP tool has annotations, input schema, pagination where relevant
   and output schema; read-only keys are rejected on writes.
5. #77 scopes and project allowlists gate all new surface; writes record
   `api:<key name>` / `mcp` attribution and events.
6. Existing endpoints stay backward compatible; new fields are additive and
   documented.
7. New checks cover REST and MCP (fake workspace fixtures, permission
   boundaries, create/update/delete round-trips); smoke, `check:harness` and
   build pass.
8. README/API docs describe the new surface and scopes.

## Out of scope

- Workspace/member administration, invites, roles and settings (U-06).
- Agent thread/conversation APIs.
- Attachments, notifications, search and API webhooks (follow-ups above).
- Block-based page editing, publishing, databases.
- API billing/quotas beyond #77 rate limits.

## Decisions (accepted per recommendation, 2026-11-06)

1. Split implementation into **U-13a (projects + task completeness)** and
   **U-13b (pages/documents)**, both under this plan.
2. U-13b v1 exposes page list/read/create/edit and page comments. Page
   sharing/access changes stay in the web UI; the API does not change sharing
   (external sharing is not planned at all).
3. Custom task fields use **raw key/value** for v1 (no typed schema).
4. Dependencies and relations are included in **U-13a**.
5. External MCP keeps a **curated external tool set**, sharing validation and
   schemas with the in-app tools where practical, but it does not expose
   internal-only `AGENT_TOOLS` automatically.
6. The expanded surface is **additive on `/api/v1`**; no `/api/v2` now.
7. Attachments, Inbox/notifications, cross-entity search and API webhooks stay
   as later follow-ups.

## Dependencies

- #77 for scopes/project allowlist/remote MCP auth.
- #80 for webhook infrastructure if API webhooks are added later.
- #79 for Agent tool parity/in-app delegation (conceptually).

## Files likely touched

- `src/app/api/v1/projects/*`, `src/app/api/v1/pages/*`, expanded issues routes.
- `src/lib/issues.ts`, `src/lib/pages.ts` — new business-layer entry points and
  permission checks.
- `mcp/server.ts` — new tools and shared schema/annotations.
- `src/lib/api-auth.ts` — scope mapping for new resources.
- `src/components/settings-view.tsx` — docs only; no UI change expected.
- README/API docs; new checks `check-api-projects.ts`,
  `check-api-task-extensions.ts`, `check-mcp-projects.ts`,
  `check-mcp-pages.ts`.
