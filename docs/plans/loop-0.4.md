# Loop 0.4: execute the approved roadmap end to end

Status: active 2026-11-06. Owner-authorised autonomous loop: implement, verify,
merge, release and deploy. Goal:
`goal-0cea1d54-7bcb-408a-b280-fb9d0205fafc`.

This file is the operational contract for every round. Read it together with
`AGENTS.md` and the plan for the item being built. If they conflict, `AGENTS.md`
wins.

## Context

- TaCos is used by **five internal people** on desktop. No public sharing,
  guests, enterprise auth, external agents, email/push/mobile or third-party
  integrations.
- U-01, U-06, U-07, U-08 and all integration work are **not planned**. Do not
  add them back.
- Inbox (#78 / PR #82) is merged. Current release is **v2.3.1**; plan docs are
  in `docs/plans/` on `main`.
- The 14-PR sequence is frozen; do not cut a feature because the team is small.
  Remove over-design instead: no speculative abstractions, no second system, no
  unused configuration dimensions.

## Order

Merge in this order unless a real dependency forces a move:

1. #77 Agent access (`agent-access.md`)
2. U-13a projects/task API surface (`api-surface.md`)
3. #79 Agent (`agent-runtime.md`, one PR with multiple commits)
4. #80 internal automations (`automations-integrations.md`, no integrations)
5. U-09 views/task UX (`views-task-ux.md`)
6. U-04 documents (`docs-knowledge.md`)
7. U-13b pages API (`api-surface.md`)
8. U-10 search (`search.md`)
9. U-11 collaboration (`collaboration.md`)
10. U-03 planning (`planning.md`)
11. U-02 insights (`insights.md`)
12. U-05 import/export (`import-export.md`)
13. U-12 desktop/self-host ops (`self-host-ops.md`)
14. Release + deploy

## Hard rules (AGENTS.md summary for the loop)

- Every round: read `AGENTS.md` before touching code. Also read the item's plan.
- Three entry points share `src/lib/issues.ts`; never bypass it. UI actions,
  `/api/v1/*` and MCP must use the business layer.
- Status changes: only assignees, except API-key/MCP automation callers. Enforce
  in lib, not only UI.
- Schema changes: add columns with `addColumnIfMissing()`; create tables/indexes
  idempotently; restart the dev server after DDL edits.
- Server components reading the DB must `await connection()` and sit in
  `<Suspense>`.
- Client components may import values only from `src/lib/constants.ts`; type-only
  imports from issues.ts are OK.
- Errors: `TacosError`; server actions return `ActionResult`, never throw to the
  client.
- Every mutation records actor/via and events. Follow existing naming.
- i18n: every new user-facing string in `src/lib/i18n/zh.ts`; run
  `npm run i18n:check`. Font sizes come from the existing scale; no ad-hoc sizes.
- Reuse before building; record any new dependency's license/fit in the PR.
- Do not weaken/delete a check to get green. Fix the code.
- One logical item = one commit where practical; a plan's phases may be several
  commits in one PR.
- Do not commit local artefacts: `data/tacos.db`, uploads, `.env`, screenshots
  from `/tmp`, `next.config.ts` local changes, `docs/plans/team-2.3.zh.md`.

## Per-PR protocol

### 1. Prepare

- `git fetch origin && git switch main && git pull --ff-only`.
- Create a branch from `main`: `feat/<area>` or `fix/<area>`.
- Read the plan document on `main`.
- Decide write scope; if parallel help is used, announce it in the shared task
  and use a separate git worktree/branch per writer. Never let two writers touch
  one worktree.

### 2. Build

- Implement the plan's commits in order. Keep the diff inside the plan.
- Add the plan's checks. Update README/i18n where the plan requires.
- Restart the dev server after DDL changes; use an isolated data dir for tests
  (`TACOS_DATA_DIR=/tmp/...`) and a non-default port when running another server.

### 3. Verify (all mandatory)

Run, and paste real output into the PR/report:

```bash
npm run lint
npm run i18n:check
npm run check:harness
npm run build
npx tsc --noEmit   # if the repo exposes it; build is the fallback type gate
```

Plus the plan-specific checks named in the plan.

Then drive the **real changed flow** in a browser:

- Start the app with a fresh seeded/dev DB; log in as the relevant user.
- Playwright + system Microsoft Edge (`chromium.launch({channel:"msedge",
  headless:true})`); no mocked server actions.
- Exercise keyboard/aria and error/empty states where the plan changes them.
- Capture screenshots at 1440×900 and 1100×800 (plus narrow if the plan says so)
  into `/tmp/tacos-e2e/evidence/<item>/`.
- Inspect every screenshot with `read_image` before declaring the PR done.
- Clean test data afterwards; stop any server started for the test.

### 4. Review and merge

- Run a fresh-context review subagent on the diff for AGENTS.md violations,
  permission/actor gaps, and missing tests. Fix findings; re-run checks.
- Open a PR with: plan link, scope, test output, E2E steps, screenshot list,
  screenshots seen, and what was not tested.
- Merge only when the PR is mergeable and all gates are green.
- Update the plan's status section and this loop's progress log after merge.
- Start the next item from the updated `main`.

## Parallel policy

- Parallel implementation is allowed only for independent items with disjoint
  file scopes and separate worktrees/branches.
- The Lead merges sequentially; no agent merges to `main` on its own.
- Independent items that can share a wave: #79 vs U-09/U-04/U-12 (after #77
  merge), U-05, U-03. Items touching `src/lib/issues.ts`, `src/db/schema.ts` or
  the same UI component must not be built concurrently without a written split.
- Each parallel worker reports: branch, commit, files touched, checks run, E2E
  evidence, and anything not tested. The Lead re-runs the gates on the merge
  result.

## Release and deploy (after item 13)

1. Full regression: `npm run lint`, `i18n:check`, `check:harness`, `build`,
   plus the release record conventions in `docs/plans/team-2.3.md`.
2. Bump to the next version after **v2.3.1**: target **v2.4.0** unless the owner
   specifies another number. Update `package.json`, any version strings, and
   write the release record under `docs/plans/`.
3. Build the Linux server tarball (`npm run server:bundle`) and the desktop
   artefacts supported locally/CI. Do not package a database.
4. Commit and tag `v2.4.0`; push branch and tag; wait for GitHub Actions; create
   the GitHub release with the built artefacts.
5. Deploy the server tarball to the team server (`tacos@43.130.57.28`, port
   3200) using the documented installer and a privileged account; take a backup
   first; keep the previous `app`/data for rollback.
6. Verify through an SSH tunnel: `/login` reachable, version is v2.4.0, health
   page/DB integrity OK, and smoke: login, task create/comment, Inbox row, and
   one Agent/delegation path where available.
7. Record release/deploy evidence here; then the goal is complete.

If server credentials/sudo/signing access are missing, stop with an exact
blocker (host, command, expected credential) and do not fake success.

## Blocker protocol

- Two different fixes for the same failure max; then mark the item blocked with
  the exact command/output and move on only if the owner allows.
- Never disable a check, skip a test, or hand-wave a failed screenshot.
- Never claim a UI change works without the browser run and viewed screenshots.

## Progress log

| Item | State | PR | Evidence |
| --- | --- | --- | --- |
| #82 Inbox | merged | #82 | E2E passed; clean dev DB |
| #77 Agent access | merged | #84 | 110/110 checks, build, mcp:test, browser E2E + 1440/1100 shots |
| #77 visibility fix | merged | #85 | fresh review blocker + medium findings fixed; MCP/REST visibility checks, batch rate limit, mixed-case pagination |
| Loop setup | done | #83 | goal + this contract |
| U-13a projects/task API | merged | #86 | 113/113 checks, build, HTTP+MCP network E2E, visibility fix merged |
| U-09 views/task UX | merged | #87 | 117/117 checks, browser E2E (views/display/bulk/template/estimate), screenshots 1440/1100 |
| U-04 documents | merged | #88 | 120/120 checks, browser E2E (backlinks/template/outline), screenshots 1440/1100 |
| U-13b pages API | next | — | — |
