# UI interaction implementation

Base: upstream main (2.2.3). Three dependent PRs: feature/ui-reliability → main; feature/ui-workflows → feature/ui-reliability; feature/ui-enhancements → feature/ui-workflows.

Statuses: todo, doing, pass, blocked. Each completed item records its check evidence. A failure surviving two different fixes is blocked; checks are never weakened. Related integration fixes remain with their original item. Existing attribution and product names remain accurate.

## Components

Radix Dropdown Menu / Context Menu / Dialog (MIT): maintained accessible primitives, replacing duplicated focus and Escape handling. react-resizable-panels (MIT, React 19): keyboard and pointer resize. Existing Floating UI, Pragmatic drag and drop, TanStack, FullCalendar and Tiptap remain. Yjs offline persistence uses the browser IndexedDB API: evaluated y-indexeddb (MIT), but its initialization and write failures do not propagate, so a small transaction wrapper reports errors and bounds initialization. Domain policies stay in existing business functions.

## Baseline

- Clean checkout, synchronized to a1dbf15 (main, 2.2.3).
- Upstream already unified the document tree and added document fetch retry. Preserve these changes.
- Dependencies and baseline checks: doing.

## Report items

| Item | Goal | Status | Evidence |
| --- | --- | --- | --- |
| NAV-01 | 右侧任务和文档详情支持拖拽宽度 | doing | — |
| NAV-02 | 展开状态与详情阅读位置缺少连续性 | doing | — |
| NAV-03 | 同名文档或项目会被当成同一个顶部标签 | doing | — |
| NAV-04 | 顶部标签不能恢复 Agent 会话和部分页面状态 | doing | — |
| NAV-05 | 标签数量上限与溢出缺少可见管理入口 | doing | — |
| NAV-06 | 左侧折叠后部分导航入口消失 | doing | — |
| NAV-07 | 折叠侧栏的长列表浮层可能一滚动就关闭 | doing | — |
| ACT-01 | 左侧文档/项目和任务行缺少统一右键与更多菜单 | doing | — |
| ACT-02 | 文档应在原列表直接重命名 | doing | — |
| ACT-03 | 置顶与收藏能力分散，任务缺少个人置顶 | doing | — |
| ACT-04 | 批量整理缺少选择模式 | todo | — |
| ACT-05 | 文档移动只有拖拽，缺少明确目标选择 | todo | — |
| ACT-06 | 文档跨私有/共享区域拖动会直接改变共享范围 | doing | — |
| ACT-07 | 文档首页缺少就地搜索、排序与路径信息 | todo | — |
| ACT-08 | 文档树缺少权限与当前定位的完整反馈 | todo | — |
| TSK-01 | 任务和文档详情加载失败可能一直显示 Loading | doing | — |
| TSK-02 | 列表高亮与键盘操作可能指向不同任务 | doing | — |
| TSK-03 | 任务说明在保存确认前清空草稿并退出编辑 | doing | — |
| TSK-04 | 标题与字段保存状态不清楚，错误被放在面板底部 | doing | — |
| TSK-05 | 连续勾选负责人或标签可能互相覆盖 | doing | — |
| TSK-06 | 评论草稿切任务丢失，输入入口在长历史底部 | doing | — |
| TSK-07 | 看板拖动失败静默，禁止跨列缺少可见原因 | doing | — |
| TSK-08 | 字段排序与看板手动排序没有明确关系 | todo | — |
| TSK-09 | 看板在窄内容区仍硬挤四列，阅读效率降低 | todo | — |
| TSK-10 | 筛选与布局记忆范围过粗，条件不够可见 | todo | — |
| TSK-11 | 表格列宽不能拖，内置字段不能原地修改 | todo | — |
| TSK-12 | 表格修改后的本地值会长期遮住服务端新值 | doing | — |
| TSK-13 | 删除自定义字段会删除所有任务的对应数据，却没有确认 | doing | — |
| TSK-14 | 日历看得到未排期数量，却无法直接安排这些任务 | todo | — |
| TSK-15 | 日期选择分步立即保存，容易产生中间值和旧草稿 | todo | — |
| TSK-16 | 新建任务要在创建后再补日期等常用信息 | todo | — |
| TSK-17 | 任务详情缺少可复制的稳定打开地址 | doing | — |
| DOC-01 | 跨项目移动文档时，子文档可能仍属于旧项目 | doing | — |
| DOC-02 | 文档新建的忙碌状态和共享结果不一致 | doing | — |
| DOC-03 | 自动保存失败缺少可恢复快照，保存状态可能过早显示成功 | doing | — |
| DOC-04 | 协作模式下部分“插入/接受 AI”动作没有进入实际编辑器 | doing | — |
| DOC-05 | 只读文档仍能点图标编辑，失败后不回滚 | doing | — |
| DOC-06 | 标题长度规则和成功回写不一致 | doing | — |
| DOC-07 | 链接/嵌入选择器只显示前 40 个文档 | todo | — |
| DOC-08 | 评论草稿切换历史栏就丢，加载失败容易被误认为没有评论 | doing | — |
| DOC-09 | 文档评论删除不可恢复，讨论操作不完整 | todo | — |
| DOC-10 | 历史版本的选择和返回 diff 可能错配 | doing | — |
| DOC-11 | 评论/历史栏固定 340px，紧凑模式未按实际宽度决定 | todo | — |
| DOC-12 | 编辑器命令和表格操作可发现性不足 | todo | — |
| DOC-13 | 上传缺少逐文件状态，完成后插入位置可能漂移 | todo | — |
| DOC-14 | 批量导入只报告汇总，异常后可能卡住状态 | todo | — |
| AGT-01 | 已有置顶会话会被最近 100 条记录截断 | doing | — |
| AGT-02 | 会话搜索只查已加载的最近标题 | todo | — |
| AGT-03 | Agent 内部会话栏固定宽度，桌面下不能主动收起 | todo | — |
| AGT-04 | 未发送草稿切换会话会丢失，发送失败缺少恢复入口 | doing | — |
| AGT-05 | 流式回复会持续把阅读位置拉回底部 | todo | — |
| AGT-06 | 审批提交失败后卡片仍消失 | doing | — |
| AGT-07 | 会话顶部与列表菜单不一致，当前会话身份不明显 | todo | — |
| GEN-01 | 菜单和列表缺少统一键盘、焦点及浮层规则 | doing | — |
| GEN-02 | Escape 会穿透子菜单，关闭创建弹窗后草稿被重置 | doing | — |
| GEN-03 | Enter 未排除输入法组合态，可能提前提交 | doing | — |
| GEN-04 | 全局搜索缺少最新请求约束，失败与无结果混淆 | doing | — |
| GEN-05 | 命令执行不反馈失败，搜索到评论却不能定位评论 | doing | — |
| GEN-06 | 原生弹窗、图标含义与文案不统一 | todo | — |
| ADM-01 | 删除保护不一致：任务单击删除，永久删除任务也不确认 | doing | — |
| ADM-02 | 回收站恢复/清除不检查结果，恢复位置不明确 | doing | — |
| ADM-03 | 通知已读和删除失败缺少完整回滚与说明 | todo | — |
| ADM-04 | 设置定位困难，部分失败反馈落在错误区域 | todo | — |

## Additional capabilities

| Item | Goal | Status | Evidence |
| --- | --- | --- | --- |
| EXTRA-01 | Personal pin and favorite order | todo | — |
| EXTRA-02 | Named personal task views | todo | — |
| EXTRA-03 | Conversation body search | todo | — |
| EXTRA-04 | Comment edit and threaded replies | todo | — |
| EXTRA-05 | Document outline, heading location, reading width and find navigation | todo | — |
| EXTRA-06 | Copy/export current Markdown and single-document PDF print layout; retain attachment links, exclude child export | todo | — |
| EXTRA-07 | Personal recent documents with clear history | todo | — |
| EXTRA-08 | Custom field rename, options, disable and restore without deleting values | todo | — |
| EXTRA-09 | Searchable members/labels/share selectors | todo | — |
| EXTRA-10 | Comfortable/compact density and terminology | todo | — |

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
