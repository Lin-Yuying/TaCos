# U-05: Import, export and data portability

Status: plan for a future PR. No implementation started. Written 2026-11-06
(loop round 4).

## Why

There is no product-level export or import today: a workspace's data lives in
SQLite plus uploads, so leaving TaCos (or moving between instances) means
copying a database file. For an internal tool that is acceptable; as soon as the
the data matters, so a portable export is still valuable for backups and
moves. Import also unlocks migration from Notion/Linear/Markdown.

## Current implementation

- Data: SQLite (`data/tacos.db` in dev/standalone, `/var/lib/tacos/data` on the
  server) + uploads directory; pages/versions/comments/attachments in the
  database; search FTS tables.
- Settings → Storage and recovery has limited surface; the server deploy script
  installs a backup timer; no download/restore UI (U-12 covers backup UX).
- No export endpoint, CLI, markdown/CSV export or importer. REST/MCP expose
  tasks but not a complete workspace export.
- Docs are markdown under a page tree; attachments are files with metadata.

## Researched best practice

- Notion: export a workspace/pages as Markdown/HTML/CSV (with subpages and
  databases), and import from Notion, Confluence, Trello, Asana and Markdown
  archives; export serves portability/backup and migration.
  https://www.notion.com/help/export-your-content
- Linear: workspace export from settings (issues/projects as CSV, plus API),
  used for migration and reporting; enterprise owner controls exports.
  https://linear.app/docs/members-roles (owner role controls workspace exports)
- Asana: project CSV export and importer for CSV from other tools.
- GitHub: repository archive/export and `git` as the portable backing.
- Common pattern: a **canonical full export** (machine-readable + human-readable
  docs/attachments), **CSV for tasks**, and **importers that preview a mapping
  before writing**, all permissioned to owners/admins.

## Comparison

| Capability | TaCos today | Notion | Linear | Asana |
| --- | --- | --- | --- | --- |
| Full workspace export | No (DB copy) | Yes (Markdown/HTML/CSV) | Yes (CSV + API) | Yes (CSV/JSON via API) |
| Docs export | No | Markdown/HTML with subpages | Documents via API | Limited |
| Attachments export | Files on disk only | Included in export zip | API | Files |
| Task CSV export | No | Databases CSV | Yes | Yes |
| Import from other tools | No | Notion/Confluence/Trello/Asana/Markdown | CSV/API | CSV builders |
| Mapping preview / dry run | No | Import UI | Import UI | Import UI |
| Owner/admin permission | N/A | Yes | Yes | Yes |
| Backup/restore UX | No (U-12) | — | — | — |

## Gaps, in priority order

1. **No export at all.** Owner cannot hand over or back up a workspace in a
   portable format.
2. **No import.** Moving to TaCos means retyping projects/tasks/docs.
3. **Attachments/docs are not bundled.** Markdown text is in SQLite; files are
   separate.
4. **No mapping/dry-run UI.** Importers must preview what will be created.
5. **No API/CLI export.** Server operators cannot script export for ops.
6. **No export audit/permission model.** Export must be owner/admin-only and
   audited with the existing events stream.

## Candidate scope (one PR, four commits)

### Commit 1 — Canonical export

- `POST /api/export/workspace` (owner/admin) creates a zip:
  - `workspace.json` — canonical entities (workspace, members without secrets,
    projects, issues with assignees/labels/fields/dependencies, comments,
    events optional, pages, page versions optional, views, automation rules,
    API key names/scopes but never hashes/secrets).
  - `docs/<page-path>.md` plus a manifest with ids, parents, versions metadata.
  - `tasks.csv` for spreadsheet/reporting.
  - `attachments/` + manifest (size, mime, page link).
- Schema version in the manifest; export job runs in-process with progress (or
  streaming for small workspaces); owner/admin only; audit event.
- CLI: `npm run export -- <workspace>` writing the same zip for server ops.

### Commit 2 — Import

- Importers: Markdown folder (page tree), Notion export zip (Markdown + CSV
  databases mapped to tasks), Linear/Asana CSV/JSON (tasks/projects/labels).
- Dry-run preview: parsed projects/tasks/pages, conflicts, unmapped fields,
  attachment count; user chooses target workspace and merge strategy (new
  workspace recommended; merge into existing with skip/rename).
- Idempotency: import id, dedupe by external id/title; attachments optional.
- Background job with progress; audit event; failure leaves no partial
  workspace (import into a new workspace first, then switch).

### Commit 3 — Export/import API and permissions

- Owner/admin-only export/import; per-export access check and audit; guest and
  member cannot export (unless explicitly allowed later).
- Export endpoint documented; signed download URL/TTL; no secrets in any file.
- Import API for automation (owner/admin token; not planned for v1).

### Commit 4 — Checks and docs

- `check-export-roundtrip.ts`: seed a workspace, export, import into an empty
  DB, compare counts/fields/docs/attachments.
- `check-import-notion.ts` / `check-import-csv.ts`: fixture archives map
  correctly; dry-run matches applied import.
- `check-export-secrets.ts`: no API key/hash/password/token in output.
- README + runbook; UI screenshots of import preview/export progress.

## Acceptance criteria

1. An owner can export a workspace and receive a zip with workspace JSON,
   markdown docs, task CSV and attachments; no secret appears in any file.
2. Importing the export into a fresh instance recreates projects, tasks, docs,
   comments, labels, fields and attachments with the same relationships.
3. A Notion export/Markdown/CSV import shows a dry-run preview (counts,
   conflicts, unmapped fields) and only writes after confirmation.
4. Import runs are idempotent; rerunning does not duplicate items; a failed
   import leaves no partial workspace.
5. Members/guests cannot export; owner/admin actions are audited.
6. Large workspaces (e.g. 10k tasks, 1k pages, 1GB attachments) export/import
   with progress and bounded memory.
7. tsc, i18n, agents-md, `check:harness` and build pass.

## Out of scope

- Continuous two-way sync with Notion/Linear/Asana.
- Perfect fidelity for Notion blocks/databases (we map docs to markdown and
  databases to tasks/CSV).
- Importing comments/versions from foreign tools where no data exists.
- Hosted migration service; this is file-based export/import.
- Real-time backup/restore (U-12).

## Decisions (accepted per recommendation, 2026-11-06)

1. The export is a canonical zip: `workspace.json`, markdown docs, `tasks.csv`,
   attachments and a manifest (not a single JSON file).
2. v1 import covers **Markdown folders including Notion-exported Markdown** and
   task CSV; native Notion database mapping and Linear/Asana importers are
   follow-ups.
3. Import targets a **new workspace** only; merging into an existing workspace
   is a follow-up.
4. Attachments are included by default with a size cap and opt-out; large
   workspaces stream with bounded memory.
5. **No import API in v1**; Settings UI + CLI only. Export may expose an ops
   API/CLI.
6. Owner/admin only; every export/import is audited; API keys export names and
   scopes only, never hashes/secrets.
7. **UI gate:** the import preview must show counts/conflicts/unmapped fields;
   progress, failure and rollback states must be explicit; 1440/1100 screenshots
   are required.

## Dependencies

- U-12 for backup/restore UX (shares the zip/manifest work).

## Files likely touched

- New `src/lib/export/` (collectors, zip, manifest, CSV) and
  `src/lib/import/` (parsers, mapping, dry-run, apply).
- `src/app/api/export/*`, `src/app/api/import/*`; CLI script.
- Settings → Export/Import pages; progress UI.
- `src/lib/i18n/zh.ts`, README/runbook, new checks.
