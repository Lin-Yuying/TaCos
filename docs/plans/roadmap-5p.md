# TaCos roadmap: five-person scope guardrails

Status: **active sequencing after the 2026-11-06 reset.** Five internal people,
desktop-only, no external sharing/agents/channels/integrations. The point of
this reset is **not to cut the PR sequence** — it is to keep the agreed features
while removing over-design. The detailed plans remain the reference.

## What stays out of scope (explicit owner decisions)

- U-01 Sharing and permissions.
- U-06 Enterprise / governance.
- U-07 External agents / A2A (internal agents only).
- U-08 Notification channels / mobile.
- All third-party integrations (Slack, GitHub, webhooks, email, push).

Everything else in the plan set stays scheduled.

## Active PR sequence

| # | PR | Plan | Core outcome |
| --- | --- | --- | --- |
| 1 | #82 (Inbox, #78) | implemented | Triage, structured notifications, Done/snooze/mutes, 90-day retention |
| 2 | #77 | `agent-access.md` | Scoped/expiring API keys + remote MCP server |
| 3 | U-13a | `api-surface.md` | Projects CRUD + task extension API/MCP |
| 4 | #79 | `agent-runtime.md` | Agent identity/delegation/review, built-in API agent, usage, harness v2 |
| 5 | #80 | `automations-integrations.md` | Internal automation rules only (integrations removed) |
| 6 | U-09 | `views-task-ux.md` | Shared views, display options, subscriptions, bulk edit, templates, estimate |
| 7 | U-04 | `docs-knowledge.md` | Page links/backlinks, templates, outline |
| 8 | U-13b | `api-surface.md` | Pages/documents API and MCP tools |
| 9 | U-10 | `search.md` | Unified search + command palette, with UI design gate |
| 10 | U-11 | `collaboration.md` | Comment threads, follow, activity feed, review threads |
| 11 | U-03 | `planning.md` | Cycles, milestones, initiatives, roadmap |
| 12 | U-02 | `insights.md` | Task-flow, agent and automation insights |
| 13 | U-05 | `import-export.md` | Canonical export + Markdown/CSV import |
| 14 | U-12 | `self-host-ops.md` | Health, verified backup/restore, update/rollback UX |

Order may move if a dependency demands it; the sequence above is the default.

## Over-design guardrails

These apply to every PR. They are the actual lesson from the five-person reset.

1. **Keep the agreed feature scope; simplify the implementation.** Do not remove
   a feature just because the team is small. Do not add a feature nobody asked
   for.
2. **No speculative abstractions.** No plugin interfaces, generic workflow DSLs,
   multi-provider normalisation, or extension points until a second real caller
   exists.
3. **Use the existing stack.** SQLite, Drizzle, server actions, existing
   components/tokens, existing queue/scheduler patterns. No new service, no new
   daemon, no new chart library if SVG suffices.
4. **One obvious UI path.** No settings matrices with unused dimensions, no
   duplicate entry points, no configuration for hypothetical teams.
5. **Internal assumptions are fine.** No guest roles, no multi-tenancy, no
   enterprise auth, no public links, no external channel fan-out.
6. **Defer the stretch items already marked in each plan** (for example ACP,
   native session adapters, custom chart types, cross-version restore,
   third-party importer fidelity, custom fields typing).
7. **Finish one PR before starting the next.** Each PR ships with its plan's
   checks + a real end-to-end test of the changed flow; screenshots where the UI
   changed.
8. **If a plan starts growing a second system inside itself, stop and split or
   cut it.** The existing plan documents already list their follow-ups; use them.

## Why this is not the same as "only do three things"

The earlier lean proposal cut features to match the team size. That was the
wrong reading: the 14 PRs are the agreed product scope; the five-person
constraint only changes **how much machinery each PR may add**. For example:

- #79 keeps delegation, review, built-in API agent and usage, but does not grow
  a general agent-orchestration platform.
- #80 keeps internal rules, but never grows a webhook/Slack integration layer.
- U-10 keeps entity coverage and filters, but not a search query language or
  analytics.
- U-12 keeps health/backup/rollback, but not clustering/observability stack.

## Not planned (do not add back without a new owner decision)

- Public/external sharing, guests, private projects (U-01).
- SSO/SCIM/audit/retention (U-06).
- External A2A agents (U-07).
- Email/push/PWA/mobile/digests (U-08).
- Slack/GitHub/webhook integrations.
