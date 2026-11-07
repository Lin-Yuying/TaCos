# UI 改版交接

状态日期：2026-11-07。分支：`feat/ui-redesign`。PR：#100。设计稿：https://claude.ai/artifact/QFNUMRQJVLoNZAuQ7Gbv67（Version 45）。

[ui-redesign.md](ui-redesign.md) 表格里的 pass 来自提交和静态检查，不代表和设计稿比对过。以本文件的状态为准。

## 规则

- 不合并到 main，不打 `v*` 标签，不部署。这三项由用户决定。标签会把版本发给所有桌面用户。
- 设计稿和现有页面不同时，设计稿更好才改。现有页面更好时保留，并写进汇报。回收站保留现有样式。
- 项目图标不改：有 emoji 显示 emoji，否则显示自动分配颜色的立方体。
- 手机端不投入。
- 示例数据不进代码。不新增后端能力。
- 测试只用全新数据目录，不碰真实数据目录和用户进程。

## 状态

- 已比对：Inbox、Review、Planning、Insights、Main、TasksList、Start、Trash、DocsIndex、SearchLanding、Activity、Agent（空白状态）、Help。
- 未比对：其余 Settings 页、Login、Register、NotFound、ExportPage、ImportPage、System、Admin、AdminWs、弹窗、菜单、文档页、项目页、桌面端和错误状态画板。
- 未运行：33 个端到端流程、Electron 验证。`check:harness`（150/150 通过）和 `next build` 已完成，见第 8、9 项。

## 剩余工作

1. 翻译 `src/app/agent-actions.ts:505` 的英文提示。
2. 核对 Settings 的 Agent 分区 harness 行图标、Cycles 选择框、Usage 的“最近 30 天”。
3. 比对 Agent 有对话时的页面。
4. 比对 Help 的目录选中态：滚动文章时目录跟随。
5. 比对 Search 的最近搜索和最近打开。
6. 种入未解析链接和已删除工作区后，比对 DocsIndex 和 Trash 下半部分。
7. 逐张比对“未比对”列出的画板，修复差异。
8. 已完成 2026-11-07：`check-agents-md.ts` 和 `check-desktop-updater-entry.ts` 通过，`npm run check:harness` 150/150 通过。
   - `check-agents-md.ts`：侧边栏的规划/动态/洞察组去掉“工作区”分组标题（设计稿有这个标题，检查禁止，作为与设计稿的已知差异保留现有做法）；底栏图标顺序改为 Help、Trash、Settings（这条失败原先被上一条挡住）。
   - `check-desktop-updater-entry.ts`：原断言写死了改版前的 640px 断点。改版把快速视图的断点移到 860px，否则 640–860 宽的列表列会把“新建任务”裁掉（实测 134px），所以断言的期望断点改为 860px。检查的保证不变：快速视图消失处必须由“视图”菜单接替；其余断言没有放宽。
9. 已完成 2026-11-07：用全新临时数据目录（`mktemp -d /private/tmp/tacos-build.XXXXXX`，`TACOS_SEED_DEMO=0`）运行 `npm run build`，退出码 0。
10. 把比对结果写回 ui-redesign.md 表格，只有并排看过的项才写 pass。
