# TaCos 2.3 plan

Branch: `feat/team-2.3-all`. Every session reads this file and `git log`, runs the smoke test, takes the first item whose status is `todo`, and commits that one item.

Smoke test: `npx tsc --noEmit && npm run -s i18n:check && npx tsx scripts/check-agents-md.ts`.

Status values: `todo`, `doing`, `done`, `blocked`. `done` needs the evidence named under "Pass". A check is never weakened to reach `done`.

Item-level checks stay cheap (types, check scripts). End-to-end tests and screenshots run once, on the whole batch, in item 26.

## Decisions

- Every item here ships in one version, 2.3.0.
- Documents stay stored as Markdown. Color, toggle and callout use custom syntax that round-trips.
- Public components come first. npm lists these as MIT on 2026-11-05: `@tiptap/extension-drag-handle-react`, `@tiptap/extension-details`, `@tiptap/extension-color`, `@tiptap/extension-text-style`, `@tiptap/extension-highlight`, `@tiptap/extension-link`, `@tiptap/extension-code-block-lowlight`, `lowlight`.
- A shared chat takes one turn at a time. A member can fork it from any message into their own private chat.
- "Move forward with Agent" becomes "Work on it in chat" and sends the first message itself, only on a new empty chat. "Hand to my Agent" becomes "Hand to Agent in background" and keeps its behaviour. Writes still follow the approval level.
- Sidebar order: Inbox, Agent; Tasks (My Tasks, Open Tasks, All Tasks, Active, Unassigned, Review); Projects; Documents (Shared, Private); Your team. Bottom: Help, Trash, Settings. Labels moves into Settings.
- Board columns run todo, in progress, done, canceled. List grouping keeps in progress first.
- CodeBuddy tool loading (2026-11-05, CodeBuddy 2.171.0, one tool on a local stub): `alwaysLoad` with `--tools DeferExecuteTool` calls the tool directly in 3 of 3 runs, 4.3 to 12.1 s; the old setting went through ToolSearch in 3 of 3, 6.2 to 10.8 s. Two runs asked to write a file made none.
- Local direct output, a document cache and a local replica are not in this plan. They wait for the timing data from item 2.

## Items

| # | Item | Status | Pass |
|---|---|---|---|
| 1 | New chat composer can send again after a chat was started | done | Check script or E2E in item 26: second chat sends |
| 2 | Per-turn timing log: model, tool requests with bytes, output upload, approval wait; try the CodeBuddy tool-loading setting | done | Check script: a turn writes every segment |
| 3 | Members change their own display name in Settings | done | Check script: own name changes; empty and over-long names refused |
| 4 | Paste and upload images and files in the Agent composer, handed to the harness on the member's computer | done | Check script: `npx tsx scripts/check-composer-attachments.ts`; real-model check in item 26 |
| 5 | Selected image in a document shows selection; delete leaves the cursor in place with no jump | done | Check script: `node --import tsx scripts/check-doc-image-selection.ts`; screenshots in item 26 |
| 6 | The two Agent buttons: new names, chat button sends the first message | done | Check script: empty chat sends once; existing chat sends nothing |
| 7 | Shared chat: one turn at a time, says who is using it; fork from a message | done | `node --import tsx scripts/check-collab-shared-chat.ts`; smoke: `npx tsc --noEmit && npm run -s i18n:check && node --import tsx scripts/check-agents-md.ts` |
| 8 | @ someone who cannot see the document: warn and offer sharing; @ yourself notifies | done | Check script: warning condition; self-mention notification |
| 9 | One left edge for title, toolbar and content on every page; board fills the width and stays readable with the task panel open; board column order; line icon for documents; Documents page groups match the sidebar; read items in Inbox stay legible | done | `node --import tsx scripts/check-team-2.3-layout.ts`; screenshots at 1440 and 1100 wide deferred to item 26 |
| 10 | Sidebar order per Decisions; one word for workspace; the document + matches the project + and shows it is working | done | `check-agents-md` glossary; screenshots in item 26 |
| 11 | Updates panel shows rendered inline changes, tables as tables | done | Check script over text and table diffs |
| 12 | Updates by several editors merge into one entry that collapses | done | `node --import tsx scripts/check-doc-update-groups.ts` |
| 13 | Table: add and delete rows and columns | done | `node --import tsx scripts/check-doc-table-edit.ts` |
| 14 | Drag blocks; turn a block into another type | done | `node --import tsx scripts/check-doc-block-turn.ts`; screenshots in item 26 |
| 15 | Link and color in the selection toolbar | done | `node --import tsx scripts/check-doc-color-syntax.ts` |
| 16 | Toggle and callout blocks | done | `node --import tsx scripts/check-doc-toggle-callout.ts` |
| 17 | Code highlighting in the document editor | done | `node --import tsx scripts/check-doc-code-highlight.ts` |
| 18 | Comment count in the page margin | done | `node --import tsx scripts/check-doc-comment-count.ts`; screenshots in item 26 |
| 19 | Embedded page content shows in the editor | todo | Confirm current behaviour, then check script or screenshots |
| 20 | Agent view for tasks | todo | Check script for the query; screenshots in item 26 |
| 21 | Blocker report from a task, notifying the right person | todo | Check script: report creates a record and a notification |
| 22 | Sub-tasks | todo | Check script: parent and child rules across UI, REST, MCP |
| 23 | Task dependencies | todo | Check script: cycle refused; blocked state shown |
| 24 | Recurring tasks | todo | Check script: next occurrence created once |
| 25 | Fix the six open security findings from the 2.2 review | todo | Check script per finding |
| 26 | Batch E2E and screenshots with real models and new data dirs; fresh-context review; fix findings | todo | Report lists tested and untested |
| 27 | Version 2.3.0, PR for the user to merge; after the merge, tag and publish | todo | PR open; release published after the merge |
