# Export and import runbook

Status: implemented in branch `feat/import-export` (U-05). The Lead owns the final
browser E2E and the 1440/1100 screenshot review.

This is the operating guide for moving a TaCos workspace between instances. It is
file-based; there is no sync service, no background backup and no public import API in
v1. Backup/restore is U-12.

## What an export contains

`Settings → Export` (owner or workspace admin) or `npm run export` writes one ZIP:

```
workspace.json          canonical entities and relationships (schemaVersion 1)
manifest.json           schema version, counts, attachment cap result, file names
tasks.csv               one row per live task
docs/<path>.md          one Markdown file per live document, parent folders = page tree
attachments/manifest.json
attachments/<id>/<name> original attachment bytes
```

`workspace.json` carries the workspace (name, key, icon, visibility), members without
credentials, projects, labels, task fields/values, tasks with assignees/labels/fields/
dependencies, task comments, documents (metadata + path), page comments, API key names/
scopes/project allowlists, shared saved views and automation rules.

Never exported: password hashes, API key hashes or plaintext keys, provider/model keys,
session or device tokens, runner tokens, join codes. Check
`scripts/check-export-secrets.ts` enforces this on a workspace containing all of them.

## Export in the UI

1. Open **Settings → Export**.
2. Pick whether attachments are included. The cap is
   `TACOS_TRANSFER_ATTACHMENT_MAX_MB` (default 1024 MB). Files over the cap are counted
   in `manifest.json` and skipped; the rest of the workspace still exports.
3. **Start export** runs in the server process. The page polls progress; leaving the
   page does not stop the job.
4. **Download export** uses a signed URL valid for 15 minutes. The URL is scoped to the
   job and still requires a signed-in owner/admin of the workspace.

Test hooks for the Lead E2E:

| Hook | Meaning |
| --- | --- |
| `export-page` | Export settings page |
| `export-start` | Start button |
| `export-attachments` | Include-attachments checkbox |
| `export-progress` / `export-phase` | Progress block and current phase |
| `export-download` | Signed download link |
| `export-error` | Start or job error |
| `export-history` / `export-job-row` | Recent exports |

## Export API and CLI

API (session auth, owner/admin only):

```bash
# Start: 202 with the job row
curl -X POST http://localhost:3000/api/export/workspace \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"<workspace id>","includeAttachments":true}'

# Poll: job status/progress; when done, downloadUrl
curl http://localhost:3000/api/export/workspace/<jobId>

# Download: short-lived signed URL returned by the poll
curl -OJ 'http://localhost:3000/api/export/download?token=<token>'
```

`POST /api/export/workspace` requires the login cookie; it is not an API-key route.
There is no `GET /api/v1/export`; the export is an owner action, not agent tooling.

CLI on the server (uses the database directly, no login):

```bash
npm run export -- <workspace id or key> [--out /path/file.zip] [--no-attachments]
```

The CLI records `export_completed` in the events audit trail attributed to `cli:export`.

## Import sources

`Settings → Import` (owner/admin) accepts:

- a TaCos export ZIP (`workspace.json` present); this restores projects, tasks,
  documents, comments, labels, fields and attachments from the canonical format;
- a Notion Markdown export ZIP (`.md` pages, nested folders, a `.csv` per database);
- any Markdown folder (zipped or selected with the folder picker);
- a task CSV.

Import always creates a **new workspace**. It never merges into or modifies the current
workspace. The new workspace is created hidden (`deleted_at` set) while rows land, so a
member never sees a half import; on success it becomes visible, on failure it is purged
with the same cleanup path as the recycle bin.

### Task CSV columns

Recognised headers (case-insensitive; several aliases each):

| Field | Headers |
| --- | --- |
| title (required) | Title, Name, Task, Issue, Summary |
| identifier | Identifier, ID, Issue ID, Key |
| description | Description, Notes, Body, Details |
| status | Status, State, Stage |
| priority | Priority, Importance, Urgency |
| project | Project, Team, List, Database |
| assignees | Assignee(s), Owner(s), People, Person |
| labels | Labels, Tags, Categories |
| due date | Due, Due date, Deadline |
| estimate | Estimate, Points, Story points, Effort |
| parent | Parent, Parent task, Subtask of, Parent ID |
| recurrence | Recurrence, Repeat |
| created | Created, Created at, Created time |

Comma, semicolon and tab delimiters are detected. Unknown columns appear under
**Unmapped fields**. Rows without a title and duplicate rows (same identifier, or same
project+title when there is no identifier) are skipped and counted under **Conflicts**.
Unknown status/priority values fall back to Todo/No priority and are listed. Due dates
must be `YYYY-MM-DD`; other formats are ignored and listed. Parent references resolve by
identifier first, then by title inside the same project.

### Markdown and Notion

- A single shared top-level folder (`Export-…`, the folder name from a Finder zip) is
  stripped so page titles stay clean.
- A page's title comes from its first `#` heading, falling back to the file name.
- Folders become documents with children; a page file and its child folder are one
  document.
- Relative images and file links become TaCos attachments and are rewritten to
  `/api/files/<id>` when attachments are included.
- Markdown pages are shared with the new workspace so the team can read them.
- Notion database CSVs become task projects named after the CSV file.
- Notion block fidelity is out of scope: callouts, synced blocks, embeds and database
  properties without a CSV header are not reconstructed.

### Preview, idempotency, rollback

1. Choose a file/folder and **Preview import**. Nothing is written.
2. The preview lists counts (projects, tasks, documents, comments, attachments, labels,
   fields, members), conflicts, unmapped fields, warnings and sections that v1 does not
   import (saved views, automation rules, API keys).
3. **Import into a new workspace** starts a background job; the page polls progress.
4. An identical source with identical options (workspace name, attachment setting and
   cap) and the same owner is detected by fingerprint and returns the workspace the first
   import created instead of duplicating it.
5. A failure after the workspace exists rolls the whole workspace back; the error says
   “Nothing was imported; the temporary workspace was removed.” Attachments are queued
   through the same cleanup path as a purged workspace.

If the server restarts while an import is running, the stale job is marked failed and
its hidden workspace is rolled back the next time Export/Import is opened.

### CLI import

```bash
npm run import -- <workspace.zip|folder|tasks.csv> \
  [--name "Workspace name"] [--owner username] [--no-attachments] [--dry-run]
```

`--dry-run` prints the same counts/conflicts/unmapped fields and writes nothing.
`--owner` defaults to the first site admin. The CLI records `import_completed` and a
transfer job so a repeated run is detected as already imported.

## Settings page test hooks

| Hook | Meaning |
| --- | --- |
| `import-page` | Import settings page |
| `import-file` / `import-folder` | ZIP/CSV picker and folder picker |
| `import-workspace-name` | New workspace name |
| `import-attachments` | Include-attachments checkbox |
| `import-preview-button` | Parse and preview |
| `import-preview` | Preview panel |
| `import-count-projects`, `import-count-tasks`, `import-count-documents`, `import-count-comments`, `import-count-attachments`, `import-count-labels`, `import-count-fields`, `import-count-members`, `import-count-members-matched` | Counts |
| `import-conflicts` / `import-unmapped` / `import-warnings` / `import-ignored` | Preview findings |
| `import-duplicate` | Identical import already exists |
| `import-confirm` | Apply |
| `import-progress` / `import-phase` | Background job progress |
| `import-result-link` | Open the new workspace |
| `import-error` | Error or rollback message |

## Limits and environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `TACOS_TRANSFER_ATTACHMENT_MAX_MB` | `1024` | Attachment bytes included in an export/import. Applies to both directions. |
| `TACOS_IMPORT_MAX_MB` | `256` | Uploaded ZIP/folder size accepted by the preview endpoint. |
| `TACOS_TRANSFER_SECRET` | generated | Optional 32+ character HMAC key for download URLs. Without it, `<data>/transfer-secret` is created with mode 0600. |

Other limits:

- The ZIP writer/reader implements standard 32-bit ZIP (STORE and DEFLATE). ZIP64 is
  rejected, so an archive must stay under 4 GB and 65,535 files. Export without
  attachments or split the workspace.
- One Markdown document is capped at 1,000,000 characters (the same cap the document
  editor uses); larger files are listed as conflicts.
- Import upload is buffered by the web framework; `TACOS_IMPORT_MAX_MB` bounds it.
- Exports and imports are owner/admin-only and logged to `events` as workspace audit
  rows (`export_completed`, `export_failed`, `import_completed`, `import_failed`).
- There is no import API in v1: the preview/apply routes under
  `/api/internal/<workspaceId>/import` are session-scoped UI endpoints, not a documented
  automation contract.
- Not supported: continuous two-way sync, perfect Notion block/property fidelity,
  Linear/Asana importers, and real-time backup/restore (U-12).

## Verification

```bash
npx tsc --noEmit
npm run i18n:check
npm run check:harness        # includes the four U-05 checks
npm run build
npx tsx scripts/check-export-roundtrip.ts
npx tsx scripts/check-export-secrets.ts
npx tsx scripts/check-import-markdown.ts
npx tsx scripts/check-import-csv.ts
```

The roundtrip check imports into a second workspace in the same database (a fresh
instance would need the same member accounts for attribution). It compares counts,
parent/dependency/comment relationships, document bodies, attachment bytes and cover,
and verifies the attachment opt-out and identical-import detection.
