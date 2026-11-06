# U-01: Sharing and permissions

Status: deep dive for the next planned PR after #77-#80. No implementation
started. Written 2026-11-06 after reading the current code and comparing with
Notion, Linear, Google Drive, Confluence, GitHub and Figma.

## Why this is needed

TaCos already has a private-sharing model inside a workspace: private pages,
page-level access, project membership that limits task visibility, project
overview grants, and private agent threads. But everything stops at the
workspace boundary, and the pieces are not one model:

- The owner highlighted the existing private sharing as a product area to
  benchmark deeply.
- External collaboration (clients, contractors, reviewers) is impossible today:
  no guest accounts, no share links, no expiry.
- Permissions are enforced differently per object (page owner-only sharing,
  project grants, workspace roles, agent threads), so audits and future
  enterprise work have no single model to build on.
- Agent access (#77) and agent runs (#79) need a scoping model: an agent or API
  key should only reach what its owner can reach.

## Current implementation

Facts from the code:

- **Workspace membership**: `workspaces` + `workspace_members` with roles
  `admin` / `member` and a `createdBy` owner. Invites use one workspace-wide
  join code (`join_codes`, link `/join/<code>`), revocable but not
  address-specific. Owner can delete the workspace (30-day restore); members
  can leave. Site super-admin at `/admin`.
- **Workspace visibility switch**: `workspaces.membersSeeAllTasks`.
  - `1` (default): every member sees every task.
  - `0`: a member sees projects they created or joined via `project_members`;
    owner/admins still see all (`workspaceFacts` / `ownProjectCondition` in
    `src/lib/issues.ts`).
- **Projects**: `projects` has no visibility column; `project_members` (join/
  leave, creator is lead) is the membership list; `project_grants` gives a
  member `comment` or `edit` on the project Overview; creator and admins are
  implicit. Project trash is 30 days.
- **Tasks**: inherit project visibility; multiple assignees,
  `issue_assignees`, claims, review status, blockers, dependencies, recurrence,
  custom fields. No per-task sharing or guest visibility.
- **Pages/documents**: `pages.shared` (0 = private to creator, 1 = every
  workspace member can see it), `pages.shareLevel` (`view`/`comment`/`edit`
  default for all members), `page_access` per-member overrides, sharing covers
  the page subtree; only the page owner can change sharing (`ownedSubtree` in
  `src/lib/pages.ts`). Pages support comments, version history, Yjs live
  collaboration (`page_collab`), attachments and project association.
- **Agent threads**: `agent_threads.visibility` is `private` (creator only) or
  `shared` (every workspace member can read and follow). No per-person sharing.
- **Audit**: mutations write `events`; there is no dedicated share/access audit
  view and no "who has access to this?" report.
- **No** external guests, public/expiring links, email invites, per-task
  sharing, "shared with me" view, import/export, SSO.

## Comparison

| Capability | TaCos today | Notion | Linear | Google Drive | Confluence | GitHub | Figma |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Share with specific workspace people | Pages (per-member level), project members, agent thread private/shared | Yes (page invite) | Yes (team membership, issue sharing) | Yes (people/groups) | Yes (space/page restrictions) | Yes (collaborators) | Yes |
| Share with external people (guests) | No | Yes (guest) | Yes (guest role) | Yes (visitor sharing for non-Google accounts) | Yes (external users) | Yes (outside collaborators) | Yes (external collaborators) |
| Public / link sharing | No | Yes (anyone on the web with link, expiry) | Limited (issue sharing inside workspace) | Yes (anyone with link, domain, expiry) | Yes (anonymous access / public links) | Repo visibility only | Yes (anyone with link) |
| Access levels | view / comment / edit (pages), comment / edit (overview grants) | view / comment / edit | Workspace roles | view / comment / edit | view / edit / admin | read / write / admin | view / comment / edit |
| Private spaces/projects | Project membership, but no explicit visibility setting | Teamspaces + restricted members | Private teams | Shared drives / restricted | Spaces with restrictions | Private repos | Private projects/teams |
| Per-person permission overrides | Yes on pages (`page_access`) | Yes | Team membership | Yes | Yes | Yes | Yes |
| Link expiry / password | No | Expiry | No | Expiry | Public link controls | No | Link access settings |
| "Shared with me" view | No | Yes (Shared) | Yes (My issues / shared) | Yes (Shared with me) | Yes | Yes | Yes |
| Who can share | Page owner only | Page owner/admin | Team owner/admin + per settings | Owner/editor | Space admin | Repo admin | File/team roles |
| Access audit / report | Events only, no UI | Admin audit | Audit log (enterprise) | Activity/audit | Audit log | Audit log | Admin logs |
| Export / portability | No | Yes | Yes | Yes | Yes | Yes | Yes |

Sources: Notion (share with one person / team / web, expiry)
https://www.notion.com/help/share-your-work; Linear (private teams, guests,
issue sharing) https://linear.app/docs/private-teams; Google Drive visitor
sharing https://support.google.com/drive/answer/9195194; Confluence permissions
https://support.atlassian.com/confluence-cloud/; GitHub outside collaborators
https://docs.github.com/en/organizations/managing-access-to-your-organizations-repositories/adding-outside-collaborators-to-repositories-in-your-organization;
Figma sharing https://help.figma.com/hc/en-us/articles/360039482274.

## Gaps, in priority order

1. **No external access at all.** No guest role, no share link, no expiry. A
   client or contractor cannot see one document or one task without joining the
   whole workspace (join code grants full member access).
2. **No first-class private projects/tasks.** `membersSeeAllTasks=0` changes
   visibility for every project at once via membership, but there is no
   per-project visibility setting, no task-level share, and no admin visibility
   report. The model is implicit rather than explicit.
3. **No unified share dialog or "Shared with me".** Page sharing is owner-only
   in the page header; projects use a member roster; threads use a private/
   shared toggle. A member cannot see "what has been shared with me" in one
   place.
4. **No share audit.** Events exist but no access report, no "who can see this
   page/project/task?", no history of role changes; Google/Notion/Linear all
   expose this.
5. **Invites are workspace-wide links only.** No address-specific invite, no
   role chosen at invite time, no guest onboarding, no expiry/usage limit on
   the join code.
6. **No data portability.** No export/import; this matters for trust and for
   enterprise buyers.
7. **Agent/API scoping is coarse.** API keys are workspace-wide (#77 adds
   scopes/project limits); agent tools are per-turn project-bound but the
   visibility model they rely on is the workspace one. External agents would
   need item-level grants.

## Candidate scope (one PR, four commits)

Proposed U-01 scope, one PR. If it grows too large in implementation, split
external access from the private-project model (ask first).

### Commit 1 — Access model

- Workspace roles: `owner`, `admin`, `member`, **`guest`** (guest sees only
  explicitly shared items; cannot browse the workspace).
- Project visibility: `workspace` (default) or `private`; private projects have
  a member list and an explicit creator/lead. Existing `project_members`
  becomes the member list for private projects; existing projects default to
  workspace visibility, preserving behavior.
- Share grants: a generic `share_grants` table (resource type: page/project/
  task/agent thread; resource id; grantee type: user/link; grantee id; level
  view/comment/edit; created by; expires at; revoked at) and a `share_links`
  table (token hash, level, expires at, revoked at, created by).
- Migration: existing `pages.shared`/`shareLevel`/`page_access`, project
  memberships and agent thread visibility are backfilled into the new model
  while keeping the old columns readable during the transition; no behavior
  change for existing users.

### Commit 2 — Sharing UX

- One Share dialog component used by pages, projects, tasks and agent threads:
  list current access, invite workspace members or guests, choose level,
  create/revoke links with expiry, show inherited access.
- "Shared with me" view in the sidebar/Inbox and a share button on the task
  panel; project settings gain a visibility toggle and roster; guest
  management in Settings → Members.
- Invites: keep join-code links, add role selection and per-link expiry;
  evaluate email invites (likely follow-up if mail is not configured).

### Commit 3 — Enforcement across the product

- All list/search/read/write paths respect the access model: tasks, projects,
  pages, comments, attachments, activity, Inbox, command palette, person pages,
  API `/api/v1/*`, MCP tools and the Agent's TaCos tool calls.
- Guests: only shared resources; no workspace lists/members/join codes; a
  read-only guest may comment when the level allows it.
- Admin override: owner/admin can see private projects (like Linear's admin
  behavior) or only if they join? Decide (see open decisions).
- Share links: read-only by default, optional comment; authenticated or link
  access; expiry checked on every request; revocation immediate.

### Commit 4 — Audit, docs, checks

- Access events (share, unshare, role change, link create/revoke, guest
  invite/remove) in the event stream; an admin "Access" view per resource and
  a workspace-wide recent sharing log.
- Export/import is out of this PR (U-05).
- Checks: `check-sharing-model.ts` (grants/levels/expiry/backfill),
  `check-sharing-enforcement.ts` (lists/search/API/MCP/agent boundaries, guest
  limits, private project tasks), `check-sharing-audit.ts` (events, admin
  report), plus UI screenshots at 1440/1100.
- Smoke, `npm run check:harness`, `npx tsc --noEmit`, i18n, build.

## Acceptance criteria

1. An owner can invite a guest by link and share one page/project/task with
   them; the guest sees only that resource (and allowed children) and no
   workspace browsing.
2. A member can create a private project; its tasks are invisible to
   non-members in lists, search, command palette, API, MCP and agent tools;
   members/admins behave as decided.
3. A share link can be created with a level and expiry and revoked
   immediately; expired/revoked links return a clear error.
4. "Shared with me" lists every resource shared with the viewer (including
   links they used) and matches the access they actually get.
5. Every share/unshare/role/link action is in the event stream and an admin can
   see "who has access to this?" for a page/project/task.
6. Existing pages/projects/tasks/agent threads behave as before for workspace
   members (backfill verified by a check).
7. Config and guest roles survive workspace restore/leave flows; leaving or
   removing a guest revokes their grants.
8. tsc, i18n, agents-md, `check:harness`, build and the new checks pass.

## Out of scope (follow-ups)

- SSO/OIDC, SCIM, domain capture, retention/audit export (U-06).
- Public website publishing/Notion Sites-style pages.
- Field-level permissions, per-comment permissions, approval workflows.
- Cross-workspace sharing (a share link that works across two TaCos installs).
- Email invites until mail configuration exists (U-08).
- Import/export (U-05).

## Open decisions (confirm before coding)

1. External access shape: guest accounts + authenticated links first
   (recommended), or anonymous public links in this PR too?
2. Private projects: include in U-01 (recommended) or a separate smaller PR?
3. Admin override: owners/admins can see all private projects (Linear-like),
   or must join to see tasks? Recommendation: admins can discover and join,
   with an audit event.
4. Share links: read-only + comment first (recommended), edit later; expiry
   presets 1/7/30 days/never.
5. Invite flow: keep join-code links with role/expiry (recommended) and defer
   email invites until a mail channel exists.
6. One PR for all four commits (recommended) or split commit 1-2 and 3-4.

## Files likely touched

- `src/db/client.ts`, `src/db/schema.ts` — roles, project visibility,
  `share_grants`, `share_links`, backfill; indexes after columns.
- `src/lib/pages.ts`, `src/lib/issues.ts`, `src/lib/auth.ts`,
  `src/lib/agent-threads.ts` — unified access checks, list filters, leave/
  remove flows, guest projection.
- New `src/lib/sharing.ts` — grant/link resolution and audit helpers.
- `src/app/api/v1/*`, `/api/agent/tools`, MCP tools — enforce the same checks.
- `src/components/doc-share.tsx` → shared Share dialog; project settings, task
  panel, agent thread menu, Settings → Members/Guest; "Shared with me" view.
- `src/lib/i18n/zh.ts`, README, new checks listed above.
