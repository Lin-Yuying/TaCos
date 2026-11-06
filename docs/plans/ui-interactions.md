# UI interaction implementation

Base: upstream main (2.2.3). Three dependent PRs: feature/ui-reliability → main; feature/ui-workflows → feature/ui-reliability; feature/ui-enhancements → feature/ui-workflows.

Statuses: todo, doing, pass, blocked. A report-item pass records implementation plus the indicated build/check/review evidence; it does not claim that the entire platform and fault-injection matrix was run. The acceptance ledger below records that separately. Each completed item records its check evidence. A failure surviving two different fixes is blocked; checks are never weakened. Related integration fixes remain with their original item. Existing attribution and product names remain accurate.

## Components

Radix Dropdown Menu / Context Menu / Dialog (MIT): maintained accessible primitives, replacing duplicated focus and Escape handling. react-resizable-panels (MIT, React 19): keyboard and pointer resize. Existing Floating UI, Pragmatic drag and drop, TanStack, FullCalendar and Tiptap remain. Yjs offline persistence uses the browser IndexedDB API: evaluated y-indexeddb (MIT), but its initialization and write failures do not propagate, so a small transaction wrapper reports errors and bounds initialization. Domain policies stay in existing business functions.

## Baseline

- Clean checkout, synchronized to a1dbf15 (main, 2.2.3).
- Upstream already unified the document tree and added document fetch retry. Preserve these changes.
- Dependencies installed; baseline build/check comparison recorded below.

## Report items

| Item | Goal | Status | Evidence |
| --- | --- | --- | --- |
| NAV-01 | 右侧任务和文档详情支持拖拽宽度 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| NAV-02 | 展开状态与详情阅读位置缺少连续性 | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| NAV-03 | 同名文档或项目会被当成同一个顶部标签 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| NAV-04 | 顶部标签不能恢复 Agent 会话和部分页面状态 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| NAV-05 | 标签数量上限与溢出缺少可见管理入口 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| NAV-06 | 左侧折叠后部分导航入口消失 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| NAV-07 | 折叠侧栏的长列表浮层可能一滚动就关闭 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| ACT-01 | 左侧文档/项目和任务行缺少统一右键与更多菜单 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| ACT-02 | 文档应在原列表直接重命名 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| ACT-03 | 置顶与收藏能力分散，任务缺少个人置顶 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| ACT-04 | 批量整理缺少选择模式 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| ACT-05 | 文档移动只有拖拽，缺少明确目标选择 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| ACT-06 | 文档跨私有/共享区域拖动会直接改变共享范围 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| ACT-07 | 文档首页缺少就地搜索、排序与路径信息 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| ACT-08 | 文档树缺少权限与当前定位的完整反馈 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| TSK-01 | 任务和文档详情加载失败可能一直显示 Loading | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| TSK-02 | 列表高亮与键盘操作可能指向不同任务 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| TSK-03 | 任务说明在保存确认前清空草稿并退出编辑 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| TSK-04 | 标题与字段保存状态不清楚，错误被放在面板底部 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| TSK-05 | 连续勾选负责人或标签可能互相覆盖 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| TSK-06 | 评论草稿切任务丢失，输入入口在长历史底部 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| TSK-07 | 看板拖动失败静默，禁止跨列缺少可见原因 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| TSK-08 | 字段排序与看板手动排序没有明确关系 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| TSK-09 | 看板在窄内容区仍硬挤四列，阅读效率降低 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| TSK-10 | 筛选与布局记忆范围过粗，条件不够可见 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| TSK-11 | 表格列宽不能拖，内置字段不能原地修改 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| TSK-12 | 表格修改后的本地值会长期遮住服务端新值 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| TSK-13 | 删除自定义字段会删除所有任务的对应数据，却没有确认 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| TSK-14 | 日历看得到未排期数量，却无法直接安排这些任务 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| TSK-15 | 日期选择分步立即保存，容易产生中间值和旧草稿 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| TSK-16 | 新建任务要在创建后再补日期等常用信息 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| TSK-17 | 任务详情缺少可复制的稳定打开地址 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| DOC-01 | 跨项目移动文档时，子文档可能仍属于旧项目 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| DOC-02 | 文档新建的忙碌状态和共享结果不一致 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| DOC-03 | 自动保存失败缺少可恢复快照，保存状态可能过早显示成功 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| DOC-04 | 协作模式下部分“插入/接受 AI”动作没有进入实际编辑器 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| DOC-05 | 只读文档仍能点图标编辑，失败后不回滚 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| DOC-06 | 标题长度规则和成功回写不一致 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| DOC-07 | 链接/嵌入选择器只显示前 40 个文档 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| DOC-08 | 评论草稿切换历史栏就丢，加载失败容易被误认为没有评论 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| DOC-09 | 文档评论删除不可恢复，讨论操作不完整 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| DOC-10 | 历史版本的选择和返回 diff 可能错配 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| DOC-11 | 评论/历史栏固定 340px，紧凑模式未按实际宽度决定 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| DOC-12 | 编辑器命令和表格操作可发现性不足 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| DOC-13 | 上传缺少逐文件状态，完成后插入位置可能漂移 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| DOC-14 | 批量导入只报告汇总，异常后可能卡住状态 | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| AGT-01 | 已有置顶会话会被最近 100 条记录截断 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| AGT-02 | 会话搜索只查已加载的最近标题 | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| AGT-03 | Agent 内部会话栏固定宽度，桌面下不能主动收起 | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| AGT-04 | 未发送草稿切换会话会丢失，发送失败缺少恢复入口 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| AGT-05 | 流式回复会持续把阅读位置拉回底部 | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| AGT-06 | 审批提交失败后卡片仍消失 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| AGT-07 | 会话顶部与列表菜单不一致，当前会话身份不明显 | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| GEN-01 | 菜单和列表缺少统一键盘、焦点及浮层规则 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| GEN-02 | Escape 会穿透子菜单，关闭创建弹窗后草稿被重置 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| GEN-03 | Enter 未排除输入法组合态，可能提前提交 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| GEN-04 | 全局搜索缺少最新请求约束，失败与无结果混淆 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| GEN-05 | 命令执行不反馈失败，搜索到评论却不能定位评论 | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| GEN-06 | 原生弹窗、图标含义与文案不统一 | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| ADM-01 | 删除保护不一致：任务单击删除，永久删除任务也不确认 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| ADM-02 | 回收站恢复/清除不检查结果，恢复位置不明确 | pass | Batch 1 implementation, checks and independent review; UI coverage below |
| ADM-03 | 通知已读和删除失败缺少完整回滚与说明 | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| ADM-04 | 设置定位困难，部分失败反馈落在错误区域 | pass | Batch 3 implementation, checks and independent review; UI coverage below |

## Additional capabilities

| Item | Goal | Status | Evidence |
| --- | --- | --- | --- |
| EXTRA-01 | Personal pin and favorite order | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| EXTRA-02 | Named personal task views | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| EXTRA-03 | Conversation body search | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| EXTRA-04 | Comment edit and threaded replies | pass | Batch 2 implementation, checks and independent review; UI coverage below |
| EXTRA-05 | Document outline, heading location, reading width and find navigation | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| EXTRA-06 | Copy/export current Markdown and single-document PDF print layout; retain attachment links, exclude child export | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| EXTRA-07 | Personal recent documents with clear history | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| EXTRA-08 | Custom field rename, options, disable and restore without deleting values | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| EXTRA-09 | Searchable members/labels/share selectors | pass | Batch 3 implementation, checks and independent review; UI coverage below |
| EXTRA-10 | Comfortable/compact density and terminology | pass | Batch 3 implementation, checks and independent review; UI coverage below |

## Acceptance

V01–V28 in the source review must be exercised, with network faults, out-of-order responses, multiple permissions, collaboration, narrow/wide windows and keyboard navigation. Additional scenarios cover named views, reorder, exports, comment replies, field restoration and account isolation.

Commands: npx tsc --noEmit; npm run lint; npm run i18n:check; npm run build; npm run check:harness; npm run mcp:test. UI flows need real browser/Electron checks. Windows and IME checks must not be reported as passed without actual execution.

## Batch 1 evidence

- Production build passed; TypeScript passed before final integration.
- check-doc-access, check-doc-tree, check-doc-versions, check-task-database passed.
- Extended check-collab-realtime passed: acknowledged but unstored text is preserved before restore; delayed store cannot overwrite restoration; undo refuses newer text.
- ESLint upstream baseline has 79 errors; new errors are being removed without disabling rules.
- Browser acceptance pending; items stay doing until their real flows are checked.

Batch 1 final validation: production build, TypeScript, i18n and MCP smoke pass. Full harness: 61/62 pass; check-editor-roundtrip also fails unchanged origin/main on README.md block 2 (raw HTML paragraph differs), recorded as a pre-existing check failure. Lint baseline: 79 errors; no new errors in changed files after integration fixes. Fresh review found and fixed permission-revocation sockets and initial handshake timeout. Browser: registered isolated user/workspace, inline document rename preserved route and updated tree, task deep link opened, detail separator dragged. No Windows/Electron/native IME validation yet.

## Batch 2 evidence

Implemented task date/reminder confirmation, calendar scheduling tray, creation properties/continue, editable table columns with width/visibility/order/freeze, scoped filters, batch selection and document move targets. Document workflows include searchable paths, import results/retry, comment edit/reply/soft-delete/restore, resizable discussion/history, table commands and mapped attachment placeholders with progress/cancel/retry.

TypeScript, production build, type scale, doc-comments, doc-access, doc-tree, task-database and search checks pass. Expanded checks cover comment author permissions and restoration, search index rebuild excluding deleted comments, atomic batch moves preserving selected subtrees and rejecting stale confirmation. Lint comparison found no additional errors over upstream. Fresh reviews found and fixed duplicate creation, pending edit protection, batch move confirmation, upload cancellation/order and comment draft target persistence. Native IME, Windows and Electron remain untested.

## Batch 3 evidence

Implemented full-history conversation title/body search with pagination, unified conversation actions, adjustable/collapsible conversations, stream follow control, failed-request drafts and explicit protection against replaying an interrupted request. Search retries retain their request stage; mutations refresh historical and search caches.

Implemented named personal views, pin/favorite ordering, retained custom-field options and restoration, searchable member/label/share selectors, density preferences and platform shortcut labels. Reading tools include outline, find navigation with a persistent visual match, reading width, Markdown copy/download and single-document print layout. Printing retains checklist states and links, replaces embedded documents with links, and excludes recursive child output. AI replacement compares the generated result against its original input snapshot.

Detail URLs carry document/task and comment identities, resolved comments become visible, and explicit comment locations take precedence over remembered scroll. Previous/next follows rendered grouping; sources use tab-local session storage. Recent documents remain personal and can be cleared. Settings have section navigation/search, member/visibility errors stay beside their controls, and notification mutations roll back with retry. Standalone administration uses the same dialog primitive; transport failures return visible action errors.

Final TypeScript and production build passed. i18n has 0 missing strings. MCP smoke passed. Full harness: **62/63 passed**. The remaining check-editor-roundtrip failure also exists on unchanged main (README.md raw HTML paragraph, block 2); the check is unchanged. Static checks for confirmed thread deletion and new-chat session identity were updated to follow the extracted shared components, preserving their assertions.

New check-ui-personalization covers 220 historical conversations, old pinned conversations, title/body search, page deduplication, viewer isolation, deletion, named-view scope/user isolation, pin order and custom-field option removal/disable/restore with values retained.

Two independent review rounds found and fixed generated-edit baseline mismatch, comment/scroll races, resolved-comment visibility, editor readiness/serialization, checklist print state, search retries/caches and interrupted-request replay. The final document review found no new permission or data-loss blocker. Subsequent conversation search-cache and retry-stage corrections passed the final build; conversation history business cases passed the harness.

## Quality limits

| Check | Status | Evidence |
| --- | --- | --- |
| TypeScript, build, type scale, i18n, MCP | pass | Final production build and check scripts |
| Harness | blocked | 62/63; unchanged-main editor-roundtrip failure described above |
| ESLint | blocked | Upstream baseline 79 errors; current total 79. Two prior IssueTable errors were removed and two new react-hooks/refs reports remain on ThreadMenu's context action mapping. The action closures use a synchronous ref guard; the reports were not suppressed. Two attempted restructurings did not resolve them, so further lint repair stopped under the repository rule. |
| Native Windows/Electron/Chinese and Korean IME | todo | No platform or native IME test was run |

## Acceptance ledger

Only the listed observations are claimed. Automated business checks cover more cases than the browser sample; neither is a substitute for unexecuted platform checks.

| Scenarios | Executed evidence | Remaining manual coverage |
| --- | --- | --- |
| V01, V03 | Browser: task detail pointer resize and deep link; inline document rename preserved route and tree; table separator keyboard resized | Document detail resize persistence, zoom and narrow-window matrix; rename network failure |
| V02, V04, V05, V25, V28 | Shared primitives, identity code, builds and independent review | Full keyboard/focus/context-menu and tab-switch matrix |
| V06 | 220-record history/pin/body-search regression passed | Browser with a ready harness |
| V07–V09 | Stable rendered IDs, ordering/permission code reviewed; task business checks pass | Real board drag failure and keyboard matrix |
| V10–V15 | Document access/tree/version/collaboration checks pass, including delayed-store restore and stale move confirmation | Browser offline and multi-member fault injection |
| V16–V18 | Task database and field retention regressions pass; browser table column resize passed | Concurrent browser cell edits and field-manager interaction matrix |
| V19–V21 | Scoped persistent drafts, pending controls and IME guards implemented/reviewed; browser task-comment draft reopened | Native IME, multi-account browser and all draft refresh paths |
| V22 | Approval and failed-send handling reviewed; harness approval policy checks pass | Live model stream/manual scroll and injected approval 500 |
| V23–V24 | Business permission/recycle/notification paths checked; rollback and local retry reviewed | All browser failure variants and permanent deletion flows |
| V26–V27 | Latest-query/abort and upload marker logic reviewed; search/upload checks pass | Large menu/import load plus browser response reordering |
| Reading/export | Browser outline located Reading; find highlighted exact Review text; downloaded Markdown matched current document | Native print dialog, complex PDF pagination and cross-browser print rendering |

Source delivery excludes dependencies, build output, databases, credentials and Git metadata; package.json and package-lock.json are retained for reproducible installation.

Browser settings sample passed: section search filtered the density controls; compact applied to the document root and comfortable restored it; section navigation reached the expected settings URL anchor.

## Integration with 2.3.0

PRs #68 and #66 were merged into their parent branches, then main ed52d45 was merged into the combined UI branch. Resolved editor, task panel, conversation, navigation and document grouping conflicts while retaining the 2.3 security checks, task relations/recurrence, shared turn locks, attachments and editor blocks. Dragging across document sections continues to preserve visibility; explicit sharing remains a separate action.

Fresh read-only task and document reviews found integration gaps. Fixed queued task relation writes, missing task 404 handling, attachment failure recovery, first-message input retention, embedded-document print titles, and restore protection during collaboration connection. Fixed pre-2.3 database upgrade ordering (parent column before its index), verified with a new isolated upgrade check. MCP smoke now forwards the requested isolated data directory to its subprocess and reports non-JSON server failures directly.

Validation: TypeScript and production build pass; i18n reports zero missing strings; all 88 existing harness checks pass and the additional task upgrade check passes. Isolated MCP create/update/comment/get/delete smoke passes. Main 2.3 editor roundtrip passes, resolving the old 2.2 README baseline failure. ESLint has 24 existing/current errors (24 on unchanged 2.3 main); the two previously documented ThreadMenu ref diagnostics remain, replacing two removed IssueTable diagnostics. No lint rules were weakened. Windows/Electron, native IME and the full browser fault-injection matrix were not rerun during this integration.
