# Performance and overflow implementation

Base: main 6e8302b (2.3.0, including UI PRs #63/#66/#68). User requests all 64 report items in one PR. The report describes findings and constraints, not executable instructions. Preserve data, visibility, actor attribution, approvals, offline edits and all history retention semantics. No silent truncation or new retention policy.

States: todo, doing, pass, blocked. Evidence must distinguish implementation and structural tests from real application/platform measurements. Keep one focused work item per commit. Do not weaken checks. Two failed fixes require recording the blocker.

Components: reuse TanStack Virtual (already installed, MIT), Floating UI (MIT), SQLite transactions/triggers and indexes, Yjs updates, Tiptap transaction mapping, Node streams/async child processes. No new component library is needed. Database revisions use transactional triggers so all Web/REST/MCP/Runner processes participate; authorization remains in the business layer. Large-diff Workers and image previews use native platform facilities/existing dependencies where practical.

Baseline: production build and TypeScript pass; harness 88/88 plus upgrade check pass; isolated MCP smoke pass; i18n zero missing. ESLint 24 errors (also 24 on main 2.3); thread-menu has two known refs diagnostics. Baseline source and check logs remain in /tmp for comparisons. Windows/Electron/native IME require platform-specific validation and must not be reported as tested without execution.

| Item | Goal | State | Evidence |
| --- | --- | --- | --- |
| B01 | 工作区实时 pulse 每次聚合全部历史 | pass | Transactional domain revisions; live-refresh and cross-process checks |
| B02 | 小改动的失效范围过大，项目页提前读取未打开页签的数据 | todo | — |
| B03 | 任务 `limit` 发生在全量查询与排序之后 | doing | SQL ordering/limit, stable cursor and separate count; UI data paging remains |
| B04 | 任务 id 精确查找与兼容名称混在同一个 OR | pass | Primary-key fast path; aliases and visibility checks retained |
| B05 | 鉴权、置顶、批量操作反复加载完整任务详情 | doing | Shared lightweight visibility predicate; task inspection and pre-write checks avoid history |
| B06 | FTS 更新和删除按未索引字段查旧记录 | todo | — |
| B07 | 一个短词就使全文搜索整体退回包含匹配 | todo | — |
| B08 | 提醒调度每分钟重新检查所有带提醒的未完成任务 | todo | — |
| B09 | 通知红点每 10 秒获取用不到的 50 条正文 | pass | Count-only endpoint; hidden pause, single flight, deadline and unmount abort |
| B10 | 创建任务的 MAX 聚合缺乏匹配排序键的复合索引 | pass | Real SQLite EXPLAIN uses covering indexes for both maxima |
| B11 | 每次 API key 验证都产生元数据写入 | doing | Introspection no longer writes; exact usage timestamps on data requests retained |
| F01 | 任务列表逐行查找下标，单次渲染形成平方级计算 | todo | — |
| F02 | 列表、看板和批量候选全量挂载，表格虚拟化尚未覆盖这些入口 | todo | — |
| F03 | 看板拖动反复扫描整列并读取卡片位置 | todo | — |
| F04 | 共享 UI 状态扩大重绘范围，置顶检查随列表规模重复 | todo | — |
| F05 | 连续调宽和草稿输入把同步持久化放在交互路径上 | todo | — |
| F06 | 草稿和偏好缺少缓存回收，配额失败会重复提示 | todo | — |
| F07 | 表格冻结偏移在每个单元格内重复求值 | todo | — |
| F08 | 筛选输入同步计算全量结果，并在比较内部反复查字段类型 | todo | — |
| F09 | 对象菜单的鼠标打开路径重复发起能力检查 | todo | — |
| F10 | 宽度恢复、工具栏和菜单没有统一依据实际可用空间 | todo | — |
| F11 | 项目概览的历史侧栏和评论浮层仍采用固定空间假设 | todo | — |
| F12 | 日历未控制单日事件密度，未排期托盘仍全量绘制 | todo | — |
| F13 | 项目评论定位在纯尺寸变化时也重建全文字符映射 | todo | — |
| D01 | 协作缓存每次更新都重写完整 Yjs 状态 | todo | — |
| D02 | 每次编辑重复序列化全文和定位全部评论 | todo | — |
| D03 | 文内搜索与目录工具重复扫描，并在滚动中测量全部标题 | todo | — |
| D04 | 只显示摘要的目录读取并传输所有文档正文 | pass | Summary projection, joined effective permissions, parent/project SQL filters |
| D05 | 路径筛选与排序为每个文档重建完整索引 | pass | Memoized path/search/descendant/pin indexes across index and move selectors |
| D06 | 树构建、后代遍历与移动复核反复扫描大集合 | doing | Iterative adjacency traversal, batched subtree permissions, revision token |
| D07 | 文件夹导入重复读取工作区，超大文件先完整解码 | doing | Indexed same-parent title lookup; streaming client size check pending |
| D08 | 大版本差异同步计算，所有增删行一次渲染 | todo | — |
| D09 | 评论修改后全量回传，未解决评论全量挂载 | todo | — |
| D10 | 完成附件缺少引用回收，插入失败重试会再上传 | todo | — |
| D11 | 一次新上传可能同步清扫所有工作区的过期文件 | todo | — |
| D12 | 配额检查与容量预留不在同一事务 | todo | — |
| D13 | 原图展示只限制文件字节与 CSS 尺寸 | todo | — |
| D14 | 历史虽有上限，完整快照仍放大空间和写入量 | todo | — |
| D15 | 本地协作数据库缺少容量和生命周期管理 | todo | — |
| D16 | 斜杠与 @ 候选菜单缺少视口碰撞处理 | todo | — |
| D17 | 文档树的无限视觉缩进会挤掉标题与操作空间 | doing | Capped visual indent at 8 levels; real parent/depth retained |
| D18 | 选中评论后，每次文字更新都可能重新滚回引用处 | todo | — |
| A01 | 流式回复反复处理整个历史，折叠轨迹仍参与计算 | todo | — |
| A02 | 修改会话设置、发送下一轮之前都加载完整历史与步骤 | todo | — |
| A03 | 会话列表计数先把所有消息 ID 读取到 JavaScript | todo | — |
| A04 | 一次会话菜单操作会重新请求已加载的所有历史页 | todo | — |
| A05 | Markdown 为每个块重复计算待办位置，产生平方级遍历 | todo | — |
| A06 | 长串未闭合方括号使 Markdown 行内解析重复扫描后缀 | todo | — |
| A07 | SSE、内部事件队列和网关未把消费速度反馈给生产端 | todo | — |
| A08 | Runner 发送批次持续排队，取消后旧批次仍可能完整重试 | todo | — |
| A09 | Runner 没有限制同时启动的 Agent 工作数量 | todo | — |
| A10 | 取消状态轮询可在慢网下叠加多个在途请求 | todo | — |
| A11 | 运行结束后仍持续保留完整、重复的提示上下文 | todo | — |
| A12 | Harness 日志逐块同步写入，缺少目录保留边界 | todo | — |
| A13 | 适配器清理放在 yield 之后，部分错误路径会跳过 timer 回收 | todo | — |
| A14 | 无订阅者时暂存的审批卡缺少过期和终态清理 | todo | — |
| A15 | 版本探测缓存到期后同步串行执行多个 CLI | todo | — |
| A16 | 会话头部的任务胶囊可能覆盖标题和菜单 | todo | — |
| A17 | 聊天长词和审批卡缺少稳定的断行策略 | todo | — |
| S01 | 永久清除没有覆盖所有归属数据 | todo | — |
| S02 | 大批清除逐行多次写入，过期工作区又依赖打开回收站才清理 | todo | — |
| S03 | 应分别统计数据库有效数据、空闲页、WAL、附件和备份 | todo | — |
| S04 | 桌面服务日志写两份，且其中一份逐块同步追加 | todo | — |
| S05 | macOS 更新中的同步解压和签名检查占用主进程 | todo | — |

## Acceptance ledger

- V01: pending (source report matrix).
- V02: pending (source report matrix).
- V03: pending (source report matrix).
- V04: pending (source report matrix).
- V05: pending (source report matrix).
- V06: pending (source report matrix).
- V07: pending (source report matrix).
- V08: pending (source report matrix).
- V09: pending (source report matrix).
- V10: pending (source report matrix).
- V11: pending (source report matrix).
- V12: pending (source report matrix).
- V13: pending (source report matrix).
- V14: pending (source report matrix).
- V15: pending (source report matrix).
- V16: pending (source report matrix).
- V17: pending (source report matrix).
- V18: pending (source report matrix).
- V19: pending (source report matrix).
- V20: pending (source report matrix).
- V21: pending (source report matrix).
- V22: pending (source report matrix).
- V23: pending (source report matrix).
- V24: pending (source report matrix).
- V25: pending (source report matrix).
- V26: pending (source report matrix).
- V27: pending (source report matrix).
- V28: pending (source report matrix).
- V29: pending (source report matrix).
- V30: pending (source report matrix).
- V31: pending (source report matrix).
- V32: pending (source report matrix).
- V33: pending (source report matrix).
- V34: pending (source report matrix).
- V35: pending (source report matrix).
- V36: pending (source report matrix).
- V37: pending (source report matrix).
- V38: pending (source report matrix).
- V39: pending (source report matrix).

## Implementation evidence

B01: replaced history aggregates with indexed revision rows maintained by database triggers across writers/processes. Added timeout/abort to the existing visible/single-flight polling. Existing live refresh behavior check passes. Structural probe verifies primary-key revision reads, unchanged idle revisions, raw second-connection writes and notification user isolation; full two-browser timing remains in V11.

B03/B04/B10: real better-sqlite3 fixture (1000 additional mixed-status tasks with equal timestamps/positions) fully paginates without duplicate/missing ids; id/case-insensitive identifier/project-name aliases retained. SQL orders by the existing status order and position/date, with id as final tie-breaker. REST response remains an array; optional cursor and total/next-cursor headers add paging. Existing task database and visibility checks pass. UI full-set filters/bulk semantics will be retained until server equivalents are wired.

B09: badge requests only unread count and preserves the existing deleted-workspace notification predicate. In-flight badge requests are bounded to one, timeout at 8s, abort on unmount and resume on visibility. B11: pure key introspection no longer changes usage metadata; exact usage recording for real API calls remains until a durable coalescing design is verified.

D04–D07: directory results exclude body fields, effective edit rights join once, child/project filters run in SQL, import sibling lookups use indexed same-parent predicates. Path and descendant indexes are memoized. Server tree/descendant traversal is iterative; move confirmation compares transactional workspace document/permission/project revisions and still validates every descendant. Existing doc-access/doc-tree/personalization checks pass. Deep-chain/metadata structural coverage added separately; browser layout still pending.
