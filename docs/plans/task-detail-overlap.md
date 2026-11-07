# Task detail content overlap

Base: origin/main 285d2b3 (2026-11-07). The supplied screenshot shows the task description, comment history and composer occupying the same vertical area.

| Item | State | Evidence |
| --- | --- | --- |
| Reproduce, correct and verify long task detail layout | pass | Latest main fetched and fast-forwarded; isolated MCP smoke passes. Real browser reproduction and production-build checks recorded below. |

Reuse the existing detail panel, Markdown renderer and browser layout. No new component or dependency is needed: this is a CSS sizing issue. Preserve editing, complete content, scroll memory and comment navigation. Measure actual element boundaries before and after the change; verify short and long content, narrow and expanded panels, editing and a large viewport.

Keep browser fixtures and screenshots under ignored output/playwright/task-layout/. No production server or user database is modified.

## Cause and change

The scroll viewport was also a column flex container. Its description child has an explicit 120px minimum and the default flex-shrink: 1. With enough content, the browser compressed its box to 120px while the Markdown continued to paint outside it. The footer correctly had shrink-0, so comments and the composer began inside the overflowing description.

Before the fix at 1440×900: description box 120px, Markdown content 1932.3125px, comment footer overlapped the Markdown by 1792.3125px. After using normal block flow inside the existing flex-1 scroll viewport: description box and content both 1932.3125px, footer begins 20px later. Content and save behavior remain unchanged.

## Verification

- `npm run mcp:test`: pass against its own temporary database.
- `npx tsc --noEmit`: pass.
- `npm run build`: pass, including TypeScript and production page generation. Existing middleware and CSS highlight warnings remain.
- Real Chromium against the production server with a fresh temporary database: nine scenarios pass (long description at 1440×900, 1920×1080, 768×900 and 480×800; expanded panel; description editor; returning from the editor; short description; empty description). Checks compare description/content/footer/composer boundaries and actual pointer hit testing of the comment input after "Write a comment". No body text was truncated.
- `npx eslint src/components/issue-panel/index.tsx`: still reports the baseline react/no-children-prop error on Subtasks and the baseline effect dependency warning. Running ESLint against `git show 285d2b3:src/components/issue-panel/index.tsx` gives the same two diagnostics.
- Screenshots: output/playwright/task-layout/before.png, after-description.png and after-comments.png. The after-comments screenshot was visually inspected; description, comment and composer occupy separate areas.

## Separate finding

The 320×640 viewport check remains **blocked**: the unchanged DetailLayout requests a 320px minimum detail panel inside an available width of about 260px, causing react-resizable-panels to collapse it. The test reports this failure; it was not removed or counted as passing. This is separate from the description's vertical compression and needs its own responsive split-panel change. Native Electron was not rebuilt or installed, and the team server was not deployed in this task.
