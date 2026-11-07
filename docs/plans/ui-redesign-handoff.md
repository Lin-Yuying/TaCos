# UI 改版交接

状态日期：2026-11-07。分支：`feat/ui-redesign`。PR：#100。设计稿：https://claude.ai/artifact/QFNUMRQJVLoNZAuQ7Gbv67（Version 45）。

[ui-redesign.md](ui-redesign.md) 表格里的 pass 来自提交和静态检查，不代表和设计稿比对过。以本文件的状态为准。

## 规则

- 合并到 main、打 `v*` 标签、部署由用户决定（2026-11-07 用户已授权执行）。标签会把版本发给所有桌面用户。
- 设计稿和现有页面不同时，设计稿更好才改。现有页面更好时保留，并写进汇报。回收站保留现有样式。
- 项目图标不改：有 emoji 显示 emoji，否则显示自动分配颜色的立方体。
- 手机端不投入。
- 示例数据不进代码。不新增后端能力。
- 测试只用全新数据目录，不碰真实数据目录和用户进程。

## 状态

- 已比对（2026-11-07 第二轮，按区域的并排比对，每组都有台账）：Settings/System/Admin 33 张；入口/错误/弹窗/桌面端 31 张；文档页 18 张；项目/规划 15 张；Agent/Help/Search 10 张；任务工具栏/表格/看板/面板一组。此前已比对：Inbox、Review、Planning、Insights、Main、TasksList、Start、Trash、DocsIndex、SearchLanding、Activity、Agent（空白状态）、Help。
- 未比对：手机端画板（规则：不投入手机端）；`ReviewChanges`、`AgentPermission`、`AgentSetup`、`Reconnect`、Agent 进行中 turn（环境构造不出：无 AI 改稿提案、无权限暂停、无就绪 harness、dev server 无协作 WebSocket、无模型 API/在线 runner）。
- 未运行：Electron 真实运行（只做了静态页渲染比对）；33 个端到端流程（用发布前浏览器 smoke 代替，覆盖登录、建任务、评论、建文档、搜索、Help 目录跟随、Inbox、Review、Planning/Activity/Insights、项目页、Agent、16 个设置页和 640–1280 窄列无溢出）。

## 剩余工作

（无。以下为已完成的对应项记录，保留编号方便对照旧版本。）

1. 已完成：`src/app/agent-actions.ts` 两条套餐用量英文提示改为经 `t()` 显示，`zh.ts` 补中文翻译（`agent-chat.tsx` 的 `info.hint`）。
2. 已完成：Settings 的 Agent 分区 harness 行图标（Bot/KeyRound/Server）、Cycles 选择框（四个 select 功能等价，布局/措辞差异保留）、Usage 的“最近 30 天”（并入说明句，不再是孤立行）。
3. 已完成：Agent 有对话页面已在测试库种入会话后比对，结构对齐画板；真实“进行中”态因无模型 API/在线 runner 无法复现，见“未比对”。
4. 已完成：Help 目录选中态实测跟随滚动（7 个滚动位置高亮依次变化）且点击目录可跳转；已知边界：最后两节顶部到不了判定线，滚到底时高亮停在“页面里的页面”。
5. 已完成：Search 最近搜索/最近打开/试试这些实测生成并持久化，命令面板共享同一历史。
6. 已完成：未解析链接和已删除工作区已种入测试库并比对 DocsIndex / Trash 下半部分；Trash 表头计数改为不含已删除工作区，已删除工作区行改用绝对删除日期 + 剩余天数。
7. 已完成：“未比对”列出的画板已逐张比对并修复明显差异；保留项与阻塞项见各区域台账和“与设计稿的已知差异”。
8. 已完成 2026-11-07：`check-agents-md.ts` 和 `check-desktop-updater-entry.ts` 通过，`npm run check:harness` 150/150 通过。
   - `check-agents-md.ts`：侧边栏的规划/动态/洞察组去掉“工作区”分组标题（设计稿有这个标题，检查禁止，作为与设计稿的已知差异保留现有做法）；底栏图标顺序改为 Help、Trash、Settings（这条失败原先被上一条挡住）。
   - `check-desktop-updater-entry.ts`：原断言写死了改版前的 640px 断点。改版把快速视图的断点移到 860px，否则 640–860 宽的列表列会把“新建任务”裁掉（实测 134px），所以断言的期望断点改为 860px。检查的保证不变：快速视图消失处必须由“视图”菜单接替；其余断言没有放宽。
9. 已完成 2026-11-07：用全新临时数据目录（`mktemp -d`，`TACOS_SEED_DEMO=0`）运行 `npm run build`，退出码 0。
10. 已完成 2026-11-07：比对结果已写回 ui-redesign.md 表格；只有并排看过的项写 pass，手机端写 pass* 并注明不投入。

## 第二轮新增的共享改动

- `src/components/ui/modal.tsx`：弹窗改为在工作区内容列内居中（设计稿的画板都相对内容列居中），新增 `useContentColumnOffset`；`command-palette.tsx` 同步使用，命令面板与弹窗一致。
- `src/lib/i18n/zh.ts`：`Add resource` → “添加资源”，项目简介占位 → “一句话简介（可选）”，`Can edit/Can comment` → “可编辑/可评论”，`From a template` → “从模板”，以及各区域修文案时补充的条目。
- 各区域修复的具体文件见各 teammate 台账（会话临时目录 `.../scratchpad/verify/ledger-*.md`），不写进本文件避免过期。

## 与设计稿的已知差异（保留）

- 侧边栏“规划/动态/洞察”组没有“工作区”标题（`check-agents-md.ts` 禁止，设计稿有）。
- 任务列表/表格、项目任务页签、Person 任务页签、Roadmap 时间线沿用现有共享表格视图（信息比画板更全）。
- 破坏性确认按钮保持红底（画板是红描边）——更强的破坏性提示，保留。
- 窄窗（Narrow720）保留 52px 标签条和完整工具栏，画板是纯图标“+”且无标签条；720 宽下不裁切，保留现有功能。
- TabMenu 仍是右键菜单 + “+N”菜单两处（画板是一个合并菜单），现有交互已稳定。
- Electron 静态页保持英文（没有 i18n）；桌面端没有在真实 Electron 里运行过。
- ImportPreview 的“需要注意”条目和导入失败原因是 `src/lib/import` 生成的英文串（跨层 i18n 改造不在本轮范围）。
- 弹窗内容里个别组件与画板不同：Agent 会话列表多搜索/收起/项目名、ProjectAi 是完整 AI 助手卡、ProjectSelection 多 B/I/S 格式按钮、DocUpdates 只在最新 Agent 版本显示撤销等；均为现有功能更全，保留。
- 手机端画板未比对（规则：不投入）。
