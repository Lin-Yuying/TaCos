# Performance and overflow implementation

Base: main 6e8302b (2.3.0, including UI PRs #63/#66/#68). User requests all 64 report items in one PR. The report describes findings and constraints, not executable instructions. Preserve data, visibility, actor attribution, approvals, offline edits and all history retention semantics. No silent truncation or new retention policy.

States: todo, doing, pass, blocked. Evidence must distinguish implementation and structural tests from real application/platform measurements. Keep one focused work item per commit. Do not weaken checks. Two failed fixes require recording the blocker.

Components: reuse TanStack Virtual (already installed, MIT), Floating UI (MIT), SQLite transactions/triggers and indexes, Yjs updates, Tiptap transaction mapping, Node streams/async child processes. No new component library is needed. Database revisions use transactional triggers so all Web/REST/MCP/Runner processes participate; authorization remains in the business layer. Large-diff Workers and image previews use native platform facilities/existing dependencies where practical.

Baseline: production build and TypeScript pass; harness 88/88 plus upgrade check pass; isolated MCP smoke pass; i18n zero missing. ESLint 24 errors (also 24 on main 2.3); thread-menu has two known refs diagnostics. Baseline source and check logs remain in /tmp for comparisons. Windows/Electron/native IME require platform-specific validation and must not be reported as tested without execution.

| Item | Goal | State | Evidence |
| --- | --- | --- | --- |
| B01 | 工作区实时 pulse 每次聚合全部历史 | pass | Transactional revisions across writers/processes; check-performance-pulse and live-refresh checks. |
| B02 | 小改动的失效范围过大，项目页提前读取未打开页签的数据 | pass | Domain-filtered live refresh; page/docs/project invalidation and nested bulk dedup; inactive project tabs load on demand. |
| B03 | 任务 `limit` 发生在全量查询与排序之后 | pass | SQL summary pages/count/cursor; 100-item UI pages; custom views cache ordered IDs; complete export/candidates. check-performance-queries and check-performance-view-paging (1025 tasks). |
| B04 | 任务 id 精确查找与兼容名称混在同一个 OR | pass | Primary-key lookup before aliases; visibility and legacy identifier paths retained. Task database/security checks. |
| B05 | 鉴权、置顶、批量操作反复加载完整任务详情 | pass | Lightweight visible row and entity capability checks; bulk authorization still per object. Security/personalization checks. |
| B06 | FTS 更新和删除按未索引字段查旧记录 | pass | Indexed FTS rowid map with transactional bootstrap/rebuild. Search lifecycle checks. |
| B07 | 一个短词就使全文搜索整体退回包含匹配 | pass | Long-term MATCH plus literal short-term validation; no result truncation. Search and Unicode checks. |
| B08 | 提醒调度每分钟重新检查所有带提醒的未完成任务 | pass | Indexed due time and bounded immediate-transaction recipient claims. Due-reminder checks. |
| B09 | 通知红点每 10 秒获取用不到的 50 条正文 | pass | Unread count-only; visible/single-flight/deadline/abort polling. Notification/live checks. |
| B10 | 创建任务的 MAX 聚合缺乏匹配排序键的复合索引 | pass | Composite MAX indexes; real SQLite EXPLAIN and task allocation fixture. |
| B11 | 每次 API key 验证都产生元数据写入 | pass | Durable per-process usage journal folds exact latest timestamps; pure introspection performs no write. check-performance-api-usage, fresh-process replay. |
| F01 | 任务列表逐行查找下标，单次渲染形成平方级计算 | pass | Memoized ID-to-index lookup; no per-row findIndex scan. |
| F02 | 列表、看板和批量候选全量挂载，表格虚拟化尚未覆盖这些入口 | pass | TanStack measured virtual task groups, board columns and batch candidates; server pages bound payload. Full candidate selection remains available. |
| F03 | 看板拖动反复扫描整列并读取卡片位置 | pass | Virtual coordinates replace full-card DOM reads; requestAnimationFrame drag updates. Native drag end-to-end remains pending. |
| F04 | 共享 UI 状态扩大重绘范围，置顶检查随列表规模重复 | pass | Stable actions/pins contexts; pin Set/rank maps reused. |
| F05 | 连续调宽和草稿输入把同步持久化放在交互路径上 | pass | Resize persists on commit; durable draft splice journal compacts after 64 patches/64KiB. Browser checkpoint interleaving test. |
| F06 | 草稿和偏好缺少缓存回收，配额失败会重复提示 | pass | Bounded persisted-value cache with shared subscriptions; empty drafts removed; quota errors throttled, volatile text and export retained. |
| F07 | 表格冻结偏移在每个单元格内重复求值 | pass | Shared frozen-column offset map; table type/behavior checks. |
| F08 | 筛选输入同步计算全量结果，并在比较内部反复查字段类型 | pass | Debounced query inputs; field lookup maps built once; server custom filters reuse applyView comparator. Paging fixture compares full results. |
| F09 | 对象菜单的鼠标打开路径重复发起能力检查 | pass | One menu-open trigger with shared in-flight capability lookup and retry. |
| F10 | 宽度恢复、工具栏和菜单没有统一依据实际可用空间 | pass | Container queries and ResizeObserver clamp remembered panel widths; wrapping toolbars and local horizontal scrolling. |
| F11 | 项目概览的历史侧栏和评论浮层仍采用固定空间假设 | pass | Responsive history panel and Floating UI comment/composer panels with flip/shift/size/autoUpdate. |
| F12 | 日历未控制单日事件密度，未排期托盘仍全量绘制 | pass | Virtual undated tray; first three events plus complete day popover. Paged totals remain explicit. |
| F13 | 项目评论定位在纯尺寸变化时也重建全文字符映射 | pass | Text/anchor map changes with content; resize remeasures retained ranges. |
| D01 | 协作缓存每次更新都重写完整 Yjs 状态 | pass | Append Yjs updates; transactional cross-tab checkpoint at 128 updates/1MiB. Browser IDB replay/sync/lock checks. |
| D02 | 每次编辑重复序列化全文和定位全部评论 | pass | Immutable document text index, incremental Markdown block serialization, affected-anchor mapping/no-anchor fast path. Differential content checks. |
| D03 | 文内搜索与目录工具重复扫描，并在滚动中测量全部标题 | pass | Shared document revision search/heading index, Unicode-safe offsets and heading observer. Content checks. |
| D04 | 只显示摘要的目录读取并传输所有文档正文 | pass | Directory/tree metadata projection excludes body; one effective-permission join. Document metadata checks. |
| D05 | 路径筛选与排序为每个文档重建完整索引 | pass | Memoized path/descendant/pin indexes shared by index and move selectors. |
| D06 | 树构建、后代遍历与移动复核反复扫描大集合 | pass | Iterative adjacency traversal and batched subtree permission snapshot; transaction compares revisions. Tree/move/access checks. |
| D07 | 文件夹导入重复读取工作区，超大文件先完整解码 | pass | Indexed same-parent sibling lookup; byte-bounded streaming decode, character cap, structured retry results. Import/content checks. |
| D08 | 大版本差异同步计算，所有增删行一次渲染 | pass | Cancellable large-diff Worker and measured virtual blocks; stale generation ignored; full compare/restore kept. Production build. |
| D09 | 评论修改后全量回传，未解决评论全量挂载 | pass | Mutation returns changed comment only; paged unresolved/replies and lazy body with edit/version guard. Comment checks. |
| D10 | 完成附件缺少引用回收，插入失败重试会再上传 | pass | Insertion retries reuse uploaded URL; reference audit includes current/Trash/history/Yjs/run content. Live-owner unknown offline drafts stay protected. Purged-owner retained files inherit reference permissions and receive seven-day grace after last reference. Access/grace/concurrent-batch fixtures. |
| D11 | 一次新上传可能同步清扫所有工作区的过期文件 | pass | Per-workspace throttled, asynchronous 100-file incomplete-upload sweep. Upload checks. |
| D12 | 配额检查与容量预留不在同一事务 | pass | Quota sum and reservation insert share immediate transaction. Upload checks. |
| D13 | 原图展示只限制文件字节与 CSS 尺寸 | pass | sharp bounded 40M pixels/two jobs/2048px previews; original downloads preserved. Storage checks cover alpha/size/rejected huge image. |
| D14 | 历史虽有上限，完整快照仍放大空间和写入量 | pass | Lossless gzip with transparent legacy reads; historical limits/seq/actor/undo rules retained. Version/content checks. |
| D15 | 本地协作数据库缺少容量和生命周期管理 | pass | Cache inventory, export, sync metadata; shared active locks/exclusive safe clear; four-second IDB open timeout. Browser checks. |
| D16 | 斜杠与 @ 候选菜单缺少视口碰撞处理 | pass | Existing Floating UI middleware reused for slash/@ menus; visualViewport and autoUpdate cleanup. |
| D17 | 文档树的无限视觉缩进会挤掉标题与操作空间 | pass | Visual indent capped at eight levels; actual parent/depth retained. Tree checks. |
| D18 | 选中评论后，每次文字更新都可能重新滚回引用处 | pass | Scroll only on explicit active-comment selection; edits repaint anchors independently. |
| A01 | 流式回复反复处理整个历史，折叠轨迹仍参与计算 | pass | Live tail state separate from memoized history; rAF delta patches and one final append; collapsed step detail stays lazy. |
| A02 | 修改会话设置、发送下一轮之前都加载完整历史与步骤 | pass | Metadata-only thread authorization/settings; initial 40-message tail, older pages and lazy step details. Agent paging/access checks. |
| A03 | 会话列表计数先把所有消息 ID 读取到 JavaScript | pass | Grouped SQL message counts; shared-chat checks. |
| A04 | 一次会话菜单操作会重新请求已加载的所有历史页 | pass | Menu patches loaded rows by id; no all-page refetch. No-overlap refreshed tail resets matching history cursor atomically. |
| A05 | Markdown 为每个块重复计算待办位置，产生平方级遍历 | pass | Memoized Markdown blocks and one optional todo-prefix pass. |
| A06 | 长串未闭合方括号使 Markdown 行内解析重复扫描后缀 | pass | Delimiter/URL suffix indexes; 12000-case parser differential/roundtrip checks. |
| A07 | SSE、内部事件队列和网关未把消费速度反馈给生产端 | pass | Pull-based SSE and byte-bounded async queues/gateway; child pause/resume feedback. Harness checks and runner queue fixture. |
| A08 | Runner 发送批次持续排队，取消后旧批次仍可能完整重试 | pass | Durable event spool before send; sequence ACK/idempotent batch ledger; abortable old retries and terminal archive. Storage/runner fixtures. |
| A09 | Runner 没有限制同时启动的 Agent 工作数量 | pass | Configurable server/Runner slots (default 2) plus same-project exclusion; queue remains pending. Runner queue checks. |
| A10 | 取消状态轮询可在慢网下叠加多个在途请求 | pass | Single-flight cancellation poll, deadline and abort on turn completion. Harness checks. |
| A11 | 运行结束后仍持续保留完整、重复的提示上下文 | pass | Terminal run context compressed losslessly; ordered event archive export streams batches; prompt context remains recoverable. |
| A12 | Harness 日志逐块同步写入，缺少目录保留边界 | pass | Asynchronous buffered rotating logs, active-PID protection, gzip and directory budget; diagnostics export. Storage tests. |
| A13 | 适配器清理放在 yield 之后，部分错误路径会跳过 timer 回收 | pass | Adapter finally blocks release timers/listeners/children even on iterator return/errors. Harness lifecycle checks. |
| A14 | 无订阅者时暂存的审批卡缺少过期和终态清理 | pass | Pending approvals expire and clear on answer/terminal grant; existing Ask/Auto/Full deletion rules remain. Approval checks. |
| A15 | 版本探测缓存到期后同步串行执行多个 CLI | pass | Parallel async startup/manual warm; expired cache returns stale and refreshes asynchronously with generation guard. Direct cold synchronous compatibility API remains outside warmed app paths. |
| A16 | 会话头部的任务胶囊可能覆盖标题和菜单 | pass | Task chips have local horizontal scrolling; header title shrinks and menu does not. |
| A17 | 聊天长词和审批卡缺少稳定的断行策略 | pass | Long-word/pre/table overflow rules in messages and approval cards; complete copy/source retained. |
| S01 | 永久清除没有覆盖所有归属数据 | pass | Explicit task/page/thread/project/workspace ownership deletion helpers; live-document cross-references retained. Cleanup/access/security fixtures. |
| S02 | 大批清除逐行多次写入，过期工作区又依赖打开回收站才清理 | pass | 100-record leased batches, root last, retryable failed jobs and background expired-workspace sweep; restore rejected after irreversible progress. Fresh-process interruption fixture. |
| S03 | 应分别统计数据库有效数据、空闲页、WAL、附件和备份 | pass | Admin storage view separates DB effective/free/WAL, uploads, compressed history/runs/logs, backup logical/allocated bytes; local drafts/Yjs inventory/export/safe clear. |
| S04 | 桌面服务日志写两份，且其中一份逐块同步追加 | pass | One server chunk log sink with backpressure; separate lifecycle log; awaited quit flush with timeout. Cross-instance logging fixture. |
| S05 | macOS 更新中的同步解压和签名检查占用主进程 | pass | Async ditto/PlistBuddy/codesign, disk preflight, abortable extraction and finally cleanup; real macOS invalid archive + abort/low-disk mocks. Successful app replacement/rollback not run. |

## Acceptance ledger

Implementation states above mean code plus the named structural/functional checks; they do not mean every suggested scale/platform benchmark ran. No CPU/RSS/p50/p95 improvement percentage is claimed. All application fixtures use temporary data directories; production/user databases are excluded.

| Scenario | Evidence and remaining coverage |
| --- | --- |
| V01–V04 | Container/layout implementation; browser 320/480/768px checks recorded below. Native desktop 200% zoom/IME and 30-level visual drag still require target-device acceptance. |
| V05–V10 | 1025-task SQLite complete-page/export/custom-sort/permission fixture; browser 216-task paging and virtual views. 5k/10k device timing and full keyboard/native drag matrix not measured. |
| V11–V12 | Separate-connection revisions, user isolation, notification and single-flight structure checks. 100 simultaneous browser clients and artificial slow-network UI timings not run. |
| V13–V15 | Search lifecycle/Unicode/visibility/FTS and due-reminder checks pass. Production multi-instance timezone boundary load benchmark not run. |
| V16–V17 | Incremental serializer differential, Unicode search/import content tests and independent 123-edit identity/reorder differential pass. 1M/500-anchor editor CPU/selection/IME profiling pending. |
| V18–V20 | Summary/tree/access/move/import checks pass. 10k directory and 1000-file browser timing not measured. |
| V21–V22 | Worker production bundle and diff/comment/version behavior checks. Rapid version-switch and 10k-comment real browser matrix pending. |
| V23–V24 | Browser IndexedDB replay, unsynced/active lock protection, export and checkpoint interleaving. Real multi-page recovery recorded below. Full storage-blocked/OS quota matrix pending. |
| V25–V27 | Attachment retry implementation; quotas/uploads/reference access/grace/concurrent batch checks; preview alpha/pixel rejection and exact original preservation. Animated/EXIF device rendering and weak-network resumable upload matrix pending. |
| V28–V30 | SQL 123-message pagination/private step authorization; independent tail/cursor review; Markdown differential tests. 1k-message renderer profiling pending. |
| V31–V33 | Runner fixture validates 1.6MiB backpressure, ACK replay, two slots/project exclusion/release; spool persistence/replay/archive checked. 60-second stalled consumer and 50 native CLI processes not run. |
| V34–V35 | Harness lifecycle/approval regression suite; async warm/expiry generation implementation. Five installed native CLI slow-version end-to-end comparison pending. |
| V36 | Version/undo and lossless compression roundtrips pass; historical retention rules unchanged. |
| V37 | Failed batch root retained, fresh-process resume, restore rejection after progress, lease exclusion, project/workspace ownership and 31-day boundary pass. |
| V38 | Active log archive protection, storage accounting and existing backup rules verified structurally; 14-point backup restore endurance test pending. |
| V39 | Real macOS ditto failure cleanup, abort and low-disk mock pass. Full signed desktop update/replacement/rollback and Windows not run. |

## Compatibility and ownership

- Tasks: remove assignees, labels, fields, blockers, dependencies, comments, events, notifications and personal state; clear references from thread/run focus. Project deletion detaches independently owned documents/conversations rather than deleting them.
- Documents: remove subtree access/favorites/comments/versions/Yjs/resources/notifications; keep root until children finish. Audit attachment references again if another writer changes content between batches. Files referenced by surviving objects are retained and authorized by those objects; stale index entries cannot grant downloads.
- Threads: remove messages, steps, flags, runs, event batches and owned unreferenced attachments after a revision-checked audit. Workspace expiry removes all workspace-owned records/files after the existing 30-day window; users/accounts and other workspaces remain.
- Completed uploads with a live owner are never aged out merely because current server text lacks a reference: unknown offline drafts cannot be proven absent. Explicit permanent owner deletion removes unreferenced files under existing deletion semantics. Cross-referenced retained files are staged only after the final current/history/Trash/Yjs reference ends, rechecked after seven days, and deleted in batches of 100. This conservative boundary preserves offline data instead of inventing a TTL for it.
- Synced caches are user-cleared only after all shared active locks close; unsynced caches export and remain protected. Existing draft keys migrate lazily; splice generations prevent checkpoint cleanup from deleting another tab's newer journal.
- Runs and historical versions compress losslessly; no new business history retention limit. Runner spool defaults to 256MiB and stops starting new work at the budget; cancelled diagnostics remain exportable. Logs rotate at 8MiB and archive within a configurable 256MiB directory budget, preserving active streams and five recent logs. Existing 14-backup recovery policy is unchanged; VACUUM is not run during active writes.

## Component decisions

Reuse existing TanStack Virtual (MIT), Floating UI (MIT), Yjs/Tiptap and SQLite. Native Worker, Node streams, gzip and IndexedDB cover their responsibilities without another library. sharp 0.35.5 (Apache-2.0, maintained public package, unrestricted local processing compatible with MIT distribution) was promoted from Next's image dependency to a direct dependency for pixel limits, EXIF rotation, animation and bounded WebP previews. Browser-only canvas lacks a reliable server-side decode boundary; handwritten codecs are unnecessary.

## Final verification

- All 100 harness checks pass, including the new paging, content, cleanup, API-use, attachment-access, storage, Runner and macOS-failure fixtures. TypeScript, isolated MCP smoke, i18n (0 missing), production build and macOS standalone server/Runner bundle pass.
- Production browser: 216 tasks reach page 201–216 with Next disabled; list/board/table/calendar at 320/480/768px have document scrollWidth equal to viewport width (12 combinations). This checks page overflow, not every native drag/keyboard behavior. Storage reference scan succeeds. A 67,910-character document comparison starts the compiled Turbopack Worker and renders its final added text.
- Browser storage: two real pages edit offline into the same IndexedDB cache and reopen with both Chinese texts intact. Additional checks protect other-tab unsynced updates and active locks, restore exported Yjs, clear closed synced caches and retain a newer journal during checkpoint interleaving.
- Standalone payload boots against a fresh temporary data directory and serves /login with HTTP 200. Packaged sharp decodes/encodes successfully. Log module is bundled into server chunks, and Electron packaging includes electron/*.mjs. The compiled diff Worker and its dependency chunks are present. No checkout database or browser fixture is shipped.
- Two independent read-only reviews verified task/Agent permission/paging and document/attachment/cleanup boundaries. Their findings about no-overlap Agent cursors, stale history responses, lazy comment bodies, cross-tab checkpoints and cross-batch references were corrected; regression fixtures pass.
- Baseline source ESLint had 24 errors; current source scan has 23 pre-existing diagnostics. Full repository lint still fails with 85 errors, chiefly existing CommonJS require/import and old script-any rules plus source hook diagnostics; the new CommonJS log import follows the existing Electron convention. No rules were disabled. Windows, native desktop update success/rollback, native IME and production performance profiling remain untested.

Reproducible commands: npm run check:harness; npm run mcp:test (now always isolated); npx tsc --noEmit; npm run i18n:check; npm run build; npm run server:bundle. Browser fixtures are temporary and are not checked into public/.
