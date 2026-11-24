---
name: tacos
description: Read and change tasks in the team's TaCos workspace — list and search tasks, create or update them, add comments, and inspect labels, members and projects. Use when the user names a TaCos task (CORE-12), asks to file, assign, close or comment on a task, or wants to know what is open in the workspace.
---

# TaCos

TaCos is the team's task and document workspace. This plugin exposes its task API through the
`tacos` MCP server. Every call acts as the person who owns `TACOS_API_KEY`, so a change shows up
in TaCos under that key's name.

## Start with context

- Call `whoami` once per conversation before the first write: it returns the workspace, project
  keys and usernames. Skip it if the user already named a project key and a username.
- Tasks are addressed by identifier (`CORE-12`) or by id; prefer the identifier.
- Read before writing: `list_tasks` to find a task, `get_task` to see its comments and activity.

## Tools

| Tool | Use |
| --- | --- |
| `whoami` | Workspace, members, projects |
| `list_tasks` | Filter by status, priority, assignee, label, project, free text |
| `get_task` | One task with comments and activity |
| `create_task` | New task; `project` defaults to the first project |
| `update_task` | Send only the fields that change |
| `add_comment` | Comment in Markdown, attributed to the API key |
| `delete_task` | Move to Trash (restorable) |
| `list_labels`, `create_label` | Workspace labels |

## Rules

- Statuses are `todo`, `in progress`, `done`, `canceled`; priorities are `none` through
  `urgent`. Aliases such as "in-progress" or "completed" are accepted.
- `assignees: []` clears the assignees; `dueDate: ""` clears the due date.
- Describe the change in the user's words, not in API terms, and report the identifier back
  (`CORE-12`) so the user can open it.
- One write per change: after `create_task` or `update_task` the returned task is already the
  current state, so do not call `get_task` again just to confirm it.
- Never print, ask for, or store the API key. If TaCos answers 401, tell the user to create a
  key in Settings → Agent access and export it as `TACOS_API_KEY`.
