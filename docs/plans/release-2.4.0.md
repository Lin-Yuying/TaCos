# TaCos 2.4.0 release record

Release after **v2.3.1**. Scope is the approved 0.4 roadmap: five-member internal
team, desktop and self-hosted server. No external integrations (Slack, GitHub,
webhooks, email, push), no sharing/guest/enterprise surfaces.

## Merged work

| PR | Item | What shipped |
| --- | --- | --- |
| #82 | Inbox | Workspace Inbox with review/mention/assignment notices and live refresh |
| #84, #85 | #77 Agent access | API keys, scopes, project allowlist, rate limits; REST/MCP visibility fix |
| #86 | U-13a | Project and task API surface for agents |
| #87 | U-09 | Saved/shared views, display options, bulk actions, templates, estimates |
| #88 | U-04 | Documents: links/backlinks, templates, outline, page comments |
| #89 | U-13b | Pages API for agents |
| #90 | #79 Agent runtime | Delegation, review/approve, API loop fallback, usage, runner |
| #91 | #80 Automations | Internal rules, dry-run, runs/audit, scheduling; no integrations |
| #92 | U-10 Search | Workspace search page + command palette; all entity kinds; CJK fallback |
| #93 | U-11 Collaboration | Comment threads/edit/delete/resolve/reactions, watchers, Activity feed, review threads |
| #94 | U-03 Planning | Cycles with rollover/capacity, project milestones, initiatives and roadmap |
| #95 | U-12 Ops | System health, diagnostics, verified backups/restore, upgrade/rollback, runner view |
| #96 | U-02 Insights | Flow/agent/automation insights, filters, CSV, shared views |
| #97 | Fix | Task-description/comment overlap and settings search removal |
| #98 | U-05 Transfer | Canonical export ZIP, Markdown/CSV/ZIP import preview into a new workspace |

## Release verification (main)

- `npx tsc --noEmit`: pass.
- `npm run i18n:check`: 1658 strings in code, 2077 in zh.ts, **0 missing**, 79 unused.
- `npm run check:harness`: **150/150 checks pass**, including upgrade checks for
  comments/events, search entries, watchers, planning, ops, insights and transfer.
- `npm run build`: pass; all routes including `/insights`, `/planning`,
  `/activity`, `/search`, `/settings/system`, `/settings/export`, `/settings/import`,
  `/api/health`.
- `npm run lint`: exits 1 on the pre-existing baseline, **82 errors / 110 warnings**
  in untouched files (`electron/*.js`, older scripts/components). No changed-file
  lint errors; no check was weakened.
- Browser E2E (Playwright + system Microsoft Edge) for each UI-affecting PR:
  Inbox, agent access/visibility, views, documents, search, collaboration,
  planning, insights, transfer, System/backup/restore, plus 1440×900 and 1100×800
  screenshots inspected. Evidence paths are recorded in the progress log and
  `/tmp/tacos-e2e/` during the run.
- Search performance on 10,000 tasks + 1,000 documents: needle 2 ms, broad
  10k-match 75–77 ms, 2-character Chinese 27–28 ms (budget 300 ms).
- Fresh-context release review: pending result recorded below before the tag.

## Known gaps / observations

- Repository lint baseline is red before this release; not caused by 0.4 and not
  suppressed.
- Import supports Markdown/CSV/TaCos ZIP only; no import REST API in v1. Large
  archives and mid-import server failure are check-covered, not stress-tested.
- Restore is same-version, owner + site-admin only, and refuses while agent runs
  are queued/running; restore under heavy concurrent writes/large uploads is not
  exercised end to end.
- Review-thread UI was covered by checks and queue/panel routes; not every review
  mutation was clicked through in the browser.
- Desktop builds are unsigned; macOS is ad-hoc signed but not notarized. The
  updater stays on the stable channel.
- No external integrations or shared/guest surfaces were added, by design.

## Release and deploy

1. Commit this record and version **2.4.0** (`package.json`, `package-lock.json`).
2. Tag `v2.4.0` and push; the tag workflow
   (`.github/workflows/windows-release.yml`) builds Windows, macOS, Linux desktop
   and the Linux server tarball, then publishes the GitHub Release.
3. Download `TaCos-Server-2.4.0-linux-x64.tar.gz`; on `ubuntu@43.130.57.28`, take
   a backup, extend the tarball into a payload directory and run
   `sudo ./deploy/install.sh ./payload`.
4. Verify through the SSH tunnel (`ssh -N -L 13200:127.0.0.1:3200`) on
   `http://127.0.0.1:13200`: `/login` 200, version 2.4.0, `/api/health`
   integrity OK, login + task/comment/Inbox smoke.
5. Rollback if needed: previous app is kept as `app.old`; `deploy/rollback.sh`
   restores the pre-upgrade backup.
