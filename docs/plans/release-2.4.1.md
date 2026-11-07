# TaCos 2.4.1 hotfix record

Hotfix after **v2.4.0**. A fresh-context review of the pushed v2.4.0 tag found
three release blockers and several audit/privacy gaps. v2.4.1 fixes the blockers
before the server deploy; v2.4.0 stays published but is superseded.

## Fixed in 2.4.1

1. **Export/import access model** — canonical exports now carry `project_members`
   per project and `page_access` overrides per document. Import recreates both,
   so a member who could open a project or had a `view` override keeps exactly
   that access after a round trip. Regression assertion added to
   `check-export-roundtrip.ts`.
2. **Inbox Reviews tab** — `"reviews"` is accepted by `listNotificationPage`
   instead of falling through to unread; `check-inbox-triage.ts` asserts the tab
   now.
3. **View-subscription leak** — workspace-scoped views check
   `memberSeesProject` for every subscriber, not only project-scoped views;
   `check-views-subscriptions.ts` covers the workspace-view + hidden-project case.
4. **Audit attribution for delete/restore** — `deleteIssue` / `restoreIssue`
   accept the caller actor, UI/REST/MCP pass it, and `deleted` / `restored`
   events name the person or API key. `check-api-task-extensions.ts` asserts the
   REST key attribution.
5. **Assignment / automation visibility** — assignment notices and automation
   `notify_users` skip recipients who cannot open the task's project.
6. **Transfer audit rows** — exports/imports are no longer rendered as blank task
   rows in workspace Activity; job history remains in Settings.
7. **System link** — only instance admins see Settings → System, matching
   `requireOpsAdmin`.
8. **Backup timer** — `tacos-backup.service` reads `/etc/tacos/env`, so a custom
   data/backup dir or retention is honored.
9. **MCP version** — the server reports the package version, not the old `0.3.0`.
10. Docs: release record, deploy host wording, and this hotfix record. v2.4.0's
    pending-review line is superseded by this record.

## Verification

- `npx tsc --noEmit`: pass.
- `npm run i18n:check`: 1660 strings in code, 2079 in zh.ts, 0 missing.
- `npm run check:harness`: **150/150** checks pass; changed checks
  `check-export-roundtrip`, `check-inbox-triage`, `check-views-subscriptions`,
  `check-api-task-extensions`, `check-activity-feed` pass individually.
- `npm run build`: pass.
- Browser E2E: Inbox Reviews tab driven with a real `review_decision` row;
  export/import pages re-smoked; screenshots inspected.
- `npm run lint` remains at the pre-existing baseline (82 errors / 110 warnings),
  unchanged from v2.4.0; no changed-file lint errors.

## Remaining known gaps (not fixed)

- Export/import still omits page links/backlinks, watchers, and task-view
  subscriptions; imported document creator metadata is attributed to the importer
  first. The preview does not list these omissions yet.
- Import attachment cap uses ZIP metadata; a malicious owner/admin ZIP could
  expand beyond the advertised cap. Owner/admin-only.
- Due reminders, claim transfers and some older notification paths do not filter
  by project visibility; assignment and automation paths are fixed here.
- Restore replaces the database only; uploads are documented as not restored.
- Desktop builds remain unsigned (macOS ad-hoc), as in 2.4.0.

## Release and deploy (done)

- Release `TaCos v2.4.1` published with seven assets; tag `v2.4.1` on merge
  commit `53c49aa`.
- Server deploy to `ubuntu@43.130.57.28`: manual backup
  `/var/lib/tacos/backups/manual-pre-2.4.1`, installer pre-upgrade backup
  `pre_upgrade-2026-11-07_03-33-41-7ff1`, app installed at `/opt/tacos/app`
  with `app.old` retained.
- Verified: `tacos.service` active; `/api/health` reports `version: 2.4.1`,
  `status: ok`, `integrity: ok`, schema 450; `/login` returns 200 through the
  SSH tunnel (`127.0.0.1:13200`); site-admin login reaches `/admin`; workspace
  data is present (`3` live tasks, `3` documents; search entries for all kinds).
- Production workspace UI (task create/comment) was not driven end to end over
  the tunnel: the production client takes 20–35 s to hydrate there, and the
  project Tasks tab did not switch in the automated run. Database-level checks
  confirm the app upgraded and serves its data; this is recorded as the one
  unverified UI smoke, not claimed as passed.
- Rollback: `sudo /opt/tacos/deploy/rollback.sh` (refuses without a verified
  pre-upgrade backup).
