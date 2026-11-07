# UI redesign

Source: design canvas Version 45 (private artifact). Where the canvas and the code disagree, the code's existing feature wins; no new backend capability. Phone and narrow-window layouts and the document-list "New document" button follow the canvas. Sample data stays out of the code.

Decisions taken: clicking the sidebar replaces the current tab (⌘-click opens a new one); the sidebar uses the new grouping; "Hand to Agent" and "Work on it in chat" both stay.

State per item: `todo`, `pass` (commit plus cheap checks: `npx tsc --noEmit`, `npm run lint`, `node scripts/check-i18n.mjs`, `npx tsx scripts/check-type-scale.ts`), `blocked` (with the failure output).

| # | Item | Canvas boards | State |
| --- | --- | --- | --- |
| 1 | Sidebar grouping | Sidebar, CustomizeSidebar, UserMenu, WorkspaceMenu, RailCollapsed | pass |
| 2 | Tabs: sidebar replaces the current tab, tabs shrink, +N overflow | Tabs, TabMenu | pass |
| 3 | Shared page frame: 52px header, 20px gutter, one primary action | every page | pass |
| 4 | Task toolbar: at most two rows, one Select entry, export under More, pagination only when needed, Previous/Next copy | Main, TasksList, TasksTable, TasksCalendar, DisplayMenu, FilterSort, SaveView, FieldManager, PersonalOrder | pass |
| 5 | Board: empty hint on top, one scroll layer | Main | pass |
| 6 | Task grid: column menu, cell editing | GridColumn, GridCell | pass |
| 7 | Bulk bar and batch selection | BulkBar, BatchSelect | pass |
| 8 | Task panel: 520px, does not squeeze the list, one action row | TaskPanel, PanelProps, PanelReview, PanelSource, PanelClosed, DelegationStates, HandOver, Pickers | todo |
| 9 | Task panel: comments, blockers, dependencies | PanelComments, PanelCommentsEmpty, PanelBlocker | todo |
| 10 | New task dialog | NewTask, NewTaskDraft, NewTaskNoProject, AiTasks | todo |
| 11 | Review queue | Review, ReviewThread | todo |
| 12 | Start screen | Start | todo |
| 13 | Inbox | Inbox, InboxRowMenu, InboxMuted | todo |
| 14 | Activity | Activity | todo |
| 15 | Search page and palette | Search, SearchLanding, SearchNoResult, CommandPalette, CommandPaletteEmpty | todo |
| 16 | Agent page | Agent, AgentSetup, AgentPermission, AgentModel, AgentSkills, ThreadMenu | todo |
| 17 | Project overview and meta | Project, ProjectSelection, ProjectComments, ProjectHistory, ProjectAi, ProjectMenus, ProjectResource, NewProject | todo |
| 18 | Project tasks and timeline | ProjectTasks, ProjectTimeline, MilestoneEdit | todo |
| 19 | Documents index | DocsIndex, DocsImport, DocsImportResult | todo |
| 20 | Document page | Doc, DocUpdates, DocMenus, DocOptions, DocShare, WatchMenu, MoveDoc, DocComments, DocOutline, DocLinks, DocFind, AiEdit, ReviewChanges, RestoreConfirm, EditorMenus, EditorBlocks | todo |
| 21 | Person page | Person | todo |
| 22 | Planning: cycles | Planning, PlanningOff, CycleAdd, CycleComplete | todo |
| 23 | Planning: roadmap and initiatives | Roadmap, Initiatives, InitiativeEdit | todo |
| 24 | Insights: four stats, one filter row, chart/table toggle | Insights | todo |
| 25 | Settings shell: grouped left navigation, Storage, Export, Import and System inside it | SettingsNav, Storage, ExportPage, ImportPage, ImportPreview, System | todo |
| 26 | Settings: profile, general, members, visibility, projects | SettingsProfile, SettingsGeneral, SettingsMembers, Invite, SettingsVisibility, SettingsProjects | todo |
| 27 | Settings: templates, cycles, automation, labels | SettingsTemplates, SettingsCycles, SettingsAutomation, RuleEdit, SettingsLabels | todo |
| 28 | Settings: Agent, usage, access, danger | SettingsAgent, AgentEdit, SettingsUsage, SettingsAccess, SettingsDanger | todo |
| 29 | Trash and Help | Trash, Help | todo |
| 30 | Entry: login, register, onboarding, join | Login, Register, Onboarding, OnboardingJoin, Join, JoinInvalid | todo |
| 31 | Admin: instance and workspace | Admin, AdminWs | todo |
| 32 | Shared states: empty, loading, load error, not found, no access, deleted workspace, reconnect, storage full, toast, confirm | EmptyStates, LoadingList, LoadingDoc, LoadError, NotFound, NoAccess, WsDeleted, Reconnect, StorageFull, Toasts, Confirm, SearchNoResult | todo |
| 33 | Desktop screens | DesktopSetup, DesktopStarting, DesktopOffline, DesktopUpdate, DesktopUpdateStates, DesktopImport | todo |
| 34 | Narrow window (720) | Narrow720, Narrow720Panel | todo |
| 35 | Phone: bottom navigation, drawer, full-screen task/doc/new-task/search | PhoneTasks, PhoneTask, PhoneDrawer, PhoneInbox, PhoneAgent, PhoneSearch, PhoneNewTask, PhoneDoc | todo |
| 36 | Batch end-to-end run and screenshots (real models, fresh data dir) | all | todo |
| 37 | Fresh-context review, PR | all | todo |
