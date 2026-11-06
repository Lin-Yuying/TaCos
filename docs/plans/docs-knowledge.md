# U-04: Documents and knowledge depth

Status: implemented on `feat/docs-knowledge` (2026-11-06); pending review and merge.
Original plan written 2026-11-06 (loop round 3). Complements #78 (Inbox).

## Why

Documents are one of TaCos's two core objects (tasks and pages). The current
document editor is stronger than expected — versions, diffs, comments, live
collaboration with presence — but it is not yet a knowledge base: pages cannot
link to each other, there are no templates, and there is no way to see what
refers to a page. That is the gap between "a markdown file with history" and
Notion/Confluence-style team knowledge.

## Current implementation

- Page tree with parent/children, project association, private/shared pages
  page favorites, recent documents,
  document index.
- Editor: markdown, Yjs live collaboration with peer presence
  (`src/lib/collab`, `use-doc-collab.ts`), attachments, cover, icons, AI inline
  edit.
- History: `page_versions` (up to 200 per page), `doc-updates` panel with line
  diffs (`doc-diff.ts`, `doc-diff-rendered.tsx`), restore and undo of agent
  edits.
- Comments: `page_comments` with quoted passage, thread parent, resolve,
  edit/delete; doc mentions and notifications (`doc_mentioned`,
  `doc_commented`).
- Search: FTS index covers docs, tasks, task comments and doc comments
  (`src/lib/search.ts`); command palette uses it.
- Gaps: no page-to-page links/backlinks, no templates, no table of contents,
  no version retention policy beyond the per-page cap, no print/PDF export,
  no suggestion/review mode, no block/database model.

## Researched best practice

Notion links & backlinks (https://www.notion.com/help/create-links-and-backlinks):

- `@`, `[[` and `+` insert links to pages; a link block creates a sub-page.
- Every block has an anchor link; pasted web links become link mentions.
- Backlinks show which pages refer to the current page, enabling a wiki graph
  instead of a folder tree.

Linear search (https://linear.app/docs/search): `/` opens global search;
`O` `I` quick-switches; search covers issues, projects and documents, with
filters, sorting and command-menu prefixes (`i`, `p`, `u`, `t`, `l`, `f`, `d`).

GitHub search (https://docs.github.com/en/search-github/getting-started-with-searching-on-github/about-searching-on-github):
scopes, qualifiers and suggestion/completion in one search box.

Common pattern: a document is a node in a link graph (backlinks + mentions),
templates make new pages cheap, and a table of contents/anchors make long pages
navigable. TaCos already has history, comments and presence; the missing layer
is the knowledge graph and reuse.

## Comparison

| Capability | TaCos today | Notion | Confluence | Google Docs |
| --- | --- | --- | --- | --- |
| Page tree / hierarchy | Yes | Yes | Spaces + page tree | Drive folders |
| Page-to-page links | No | `@`, `[[`, link block | Links + macros | Links |
| Backlinks / "linked from" | No | Yes | Yes (links) | No (comments/activity) |
| Templates | No | Template gallery, page templates | Templates/blueprints | Template gallery |
| Version history + diff | Yes (diff + restore) | Yes (page history) | Yes | Yes (version history) |
| Inline comments / resolve | Yes (quoted, threaded, resolved) | Yes | Yes | Yes |
| Suggestions/review mode | No | No | No | Yes (suggesting mode) |
| Live collaboration + presence | Yes | Yes | Yes (editor) | Yes |
| Table of contents / anchors | No (markdown headings only) | Yes | Yes (macros) | Outline |
| Export/print | No (U-05) | Yes | Yes | Yes |
| Block/database model | No (markdown) | Yes | Limited (macros) | No |

## Gaps, in priority order

1. **No knowledge graph.** Pages cannot reference each other, and there is no
   backlink panel; the page tree is the only navigation.
2. **No templates.** Every new page starts empty; recurring docs (meeting notes,
   specs, retros, project briefs) are retyped.
3. **No long-page navigation.** Markdown headings exist, but no outline/table of
   contents or anchor links in the reader.
4. **Version lifecycle.** History exists (200/page) but there is no retention
   policy or UI for older versions; no diff between arbitrary versions.
5. **No print/PDF/export** (U-05 covers export).
6. **No suggestion/review mode** for controlled edits; history + restore is the
   current safety net.
7. **No block/database model** — deliberately out of scope; TaCos is markdown,
   not Notion databases.

## Candidate scope (one PR, four commits)

### Commit 1 — Links and backlinks

- Page link syntax/picker: `[[` or `@` in the editor inserts a page reference;
  task identifiers (`CORE-7`) and document links render as mentions.
- `page_links` table (source type page/task/comment, source id, target page id,
  created by/at) updated on save; permission-aware resolution.
- "Linked from" panel on the page (and mention counts); links are indexed by
  search and command palette; deleting/trashing a target shows an unresolved
  link state instead of breaking.
- Mention notifications reuse `doc_mentioned` where appropriate.

### Commit 2 — Templates

- `page_templates` table (workspace/project scope, name, title, doc, created
  by); Settings → Templates management for owners/admins; "New from template"
  in page/project docs, plus default template per project.
- Template variables (date, author, project) filled on creation; history
  records the source template.
- Keep the markdown model (no block editor).

### Commit 3 — Reading and organization

- Table of contents/outline from headings in the doc reader (jump links);
  anchor links for headings; "Copy link to heading".
- Doc index/recent pages improvements (group by project, recently edited,
  favorites, unresolved links).
- Optional: print stylesheet (PDF export stays U-05).

### Commit 4 — Checks and docs

- `check-doc-links.ts`: link creation/backlink update, permission handling,
  deletion/unresolved state.
- `check-doc-templates.ts`: template creation/use/variables, default template.
- `check-doc-outline.ts`: heading anchors and ToC generation.
- UI screenshots at 1440/1100; README; smoke + harness.

## Acceptance criteria

1. A page can link to another page via the picker; the target shows "Linked
   from" with the referencing page/task/comment; access is checked per viewer.
2. Trashing a linked page leaves a visible unresolved link rather than a dead
   link; restoring re-resolves it.
3. Owners can create/edit templates; creating a page from a template fills
   title/body/variables and records the template.
4. The reader shows a table of contents for headings and allows copying a
   heading link; long pages are navigable without leaving the page.
5. Existing version history, comments, presence and sharing behave unchanged;
   tsc, i18n, agents-md, `check:harness` and build pass.

## Out of scope

- Block-based editor, databases, synced blocks (Notion database model).
- Suggestion mode and formal review/approval for docs.
- Export/import and print/PDF (U-05).
- Public web publishing and external sharing (not planned: internal company use only).
- AI Q&A/summarization over the doc corpus (possible follow-up after U-02).

## Decisions (accepted per recommendation, 2026-11-06)

1. Page links use the `[[` picker; `@` stays for mentions and task
   identifiers keep their current rendering.
2. Backlinks v1 covers **page → page only**; task/comment sources are a
   follow-up.
3. Templates start at the **workspace level**; per-project templates and a
   default template are follow-ups.
4. The outline/table of contents lives in the **reader sidebar**, not only in
   the editor.
5. Version retention stays at 200 versions per page in this PR; no arbitrary
   version diff or retention policy yet.
6. Links store the page **id** and resolve the title at render time; access
   checks use the existing page visibility rules (no guests).
7. Existing plain text and `@mentions` are **not auto-converted** to page links;
   only new `[[` links are recorded.

## Dependencies

- U-05 for export/print.
- U-10 for unified search integration (links/templates appear in results).

## Files likely touched

- New `page_links` / `page_templates` tables and bootstrap changes.
- `src/lib/pages.ts`, `src/lib/doc-*.ts`, markdown rendering/editor.
- `src/components/doc-page.tsx`, `doc-panel.tsx`, `doc-updates.tsx`,
  doc tree/index components.
- `src/lib/search.ts`, command palette for link/template results.
- Settings for templates; i18n; new checks.

## Implementation notes (2026-11-06)

Per-commit state:

1. **Links and backlinks** — done. `page_links` stores workspace, source kind/id,
   target page id and the last known target title; v1 writes `source_kind='page'`
   only. Outgoing rows are derived from the saved Markdown on create/save/restore
   and replaced in the same transaction as the body, so Yjs stores never own link
   state. `[[` opens a picker in the main (TipTap) editor; the compact Markdown
   editor opens the same picker on `[[` as well as `/document`. References resolve
   by page id first and title second at render time. A trashed or hidden target
   renders dashed and unresolved; restoring it resolves again. The "Linked from"
   side panel and the document index's unresolved list filter by page visibility.
   Templates and links are not auto-converted from existing text or `@mentions`.
2. **Page templates** — done, workspace-level only. Settings › Page templates is
   visible to all members, editable by the owner/admin. New pages can start from
   one in the document tree, document index and project Documents. Variables are
   `{date}`, `{author}`, `{project}`; unknown placeholders are left alone. The page
   keeps a template-name snapshot and its first version records the source, so a
   deleted template has no effect on existing pages. Per-project templates and a
   default template stay follow-ups.
3. **Outline and anchors** — done except print. The reader sidebar builds from
   headings; heading ids are stable for duplicates and Chinese text; `#` beside a
   heading and the outline's copy button create `?heading=<id>` links, which the
   reader scrolls to. The document index shows backlink counts and unresolved
   links; recent documents show an icon and edit time. A print stylesheet was
   skipped: PDF/print is U-05.
4. **Checks and docs** — `check-doc-links.ts`, `check-doc-templates.ts` and
   `check-doc-outline.ts` added; `check-review-doc-drag.ts` moved its create-path
   assertions to `NewPageMenu`. README and this status updated. Browser
   E2E/screenshots are run by the Lead.

Not tested here: browser interaction (picker keyboard flow, panel layout at 1440
and 1100, copied-link scroll), and a real multi-client Yjs session with link
edits. Library checks cover the data rules; `npm run build` covers types.
