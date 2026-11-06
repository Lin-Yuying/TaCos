# U-06: Enterprise and governance

Status: plan for a future PR. No implementation started. Written 2026-11-06
(loop round 4).

## Why

TaCos is used by a small team today, but the roadmap (#77 agent access,
external agents U-07, self-host U-12, import/export U-05) turns it into a tool
others may rely on. Enterprises and larger teams need SSO, provisioning, an
audit trail, retention and a permission model they can reason about. The current
roles are owner/admin/member with no SSO, audit UI or retention policy.

## Current implementation

- Roles: workspace owner (`workspaces.createdBy`), `admin`/`member`
  (`workspace_members.role`); join-code invites; site super-admin at `/admin`.
- Guest/private-project model is **not planned** (internal company use only).
- Audit: `events` per issue, activity streams; no security audit log
  (logins, role changes, exports, API key changes, sharing changes), no UI/API.
- No SSO/OIDC/SAML, no SCIM, no retention policy, no session management UI.
- API keys, MCP, agents and integrations exist; each needs permissions/audit.
- No data export yet (U-05); no backup/ops UI (U-12).

## Researched best practice

Linear members and roles (https://linear.app/docs/members-roles.md):

- Workspace owner vs admin vs team owner vs member vs guest; configurable team
  permissions (team access, membership, settings, labels, templates, views,
  agent skills, issue sharing); suspend/deprovision; SCIM explains that member
  management moves to the IdP.
- Guest accounts: restricted to explicitly shared teams; billed as members.

Linear audit log (https://linear.app/docs/audit-log.md):

- 90-day retained audit events for account access, subscriptions and settings
  changes including actor IP/country; owner-only UI with filters; API for
  advanced queries; stream to webhook/SIEM with signing secret.

Notion enterprise: SAML/SCIM, audit log, workspace analytics, admin controls and
data retention (https://www.notion.com/enterprise). GitHub Enterprise: SAML/SCIM,
audit log streaming.

Common pattern: **SSO + SCIM/provisioning + role matrix + security audit log +
retention/export**, with owner-only sensitive operations.

## Comparison

| Capability | TaCos today | Linear | Notion Enterprise | GitHub Enterprise |
| --- | --- | --- | --- | --- |
| SSO (SAML/OIDC) | No | Yes | Yes | Yes |
| SCIM / auto-provisioning | No | Yes | Yes | Yes |
| Role matrix / configurable permissions | No (owner/admin/member) | Yes | Yes | Yes |
| Guest accounts | Not planned (internal only) | Yes | Yes | Yes (guests) |
| Security audit log + UI | No (issue events only) | Yes (90 days, API, SIEM) | Yes | Yes (streaming) |
| Audit retention policy | No | 90 days | Configurable | Configurable |
| Session/device management | No | Limited | Yes | Yes |
| Data export (owner) | No (U-05) | Yes | Yes | Yes |
| Retention/legal hold | No | Limited | Yes | Yes |

## Gaps, in priority order

1. **No SSO.** No SAML/OIDC sign-in; every member uses username/password.
2. **No provisioning.** No SCIM/domain auto-join; roles set manually; no
   suspend/deprovision flow.
3. **No security audit log.** Login, role, sharing, API key, export, agent and
   automation changes are not centrally visible with actor/IP.
4. **No retention policy.** Workspace data, trash, audit logs and agent logs
   have ad-hoc retention.
5. **No permission matrix.** Team/project/admin actions are hard-coded; the deferred
   sharing work would not add configurable policies.
6. **No session security controls.** No forced logout, session list, or IP/
   domain restrictions.

## Candidate scope (one PR, four commits)

Default one PR; SSO alone is large, so it may split after commit 1.

### Commit 1 — SSO (OIDC first)

- OIDC authorization-code flow with PKCE; provider metadata (issuer, client id/
  secret) in an admin-only settings page; group/email domain mapping to
  workspace roles; JIT provisioning or link-by-email.
- Session hardening: secure cookies, rotation, max session age, "sign out
  everywhere", audit login/logout/failure with IP/UA.
- SAML and SCIM are follow-ups if the team uses an IdP that needs them; keep the
  interface generic.

### Commit 2 — Provisioning and lifecycle

- Domain allowlist / auto-join for matching emails (configurable roles).
- SCIM 2.0 endpoints (`/api/scim/v2/Users`, `/Groups`) for user lifecycle and
  role mapping; deprovisioning suspends sessions and revokes API keys/grants.
- Suspend/reactivate member; keep historical attribution; audit changes.

### Commit 3 — Audit log and retention

- Append-only audit events covering auth, membership/roles, sharing,
  API keys (#77), external agents (U-07), exports (U-05), settings, automation
  rules (#80), admin actions.
- Owner/admin audit page with filters (event type, actor, date, IP) and CSV
  export; API endpoint; optional webhook/SIEM streaming (reuse #80 webhooks).
- Retention policy: 90 days default for audit events, configurable trash/
  workspace/agent-log retention, legal-hold flag (owner only).
- No secret data in audit payloads.

### Commit 4 — Governance UI, checks and docs

- Permission matrix for workspace/team/project actions (read from the existing sharing model),
  admin console (members, roles, sessions, SSO, audit, retention, exports).
- `check-sso-oidc.ts` (fake provider login, group mapping, session rules),
  `check-scim.ts` (provision/deprovision, role map), `check-audit-log.ts`
  (events/permissions/retention/export), `check-retention.ts`.
- README/runbook, screenshots.

## Acceptance criteria

1. An owner can configure OIDC SSO; a member signs in through the IdP and gets
   the mapped role; invalid/expired tokens are rejected.
2. SCIM or domain auto-join provisions users; deprovisioning suspends sessions
   and revokes API keys/grants.
3. Owner/admin audit page lists auth/member/role/sharing/API key/export/agent/
   automation/settings events with actor and IP, filterable and exportable; no
   secret appears in events.
4. Audit retention defaults to 90 days and is configurable by the owner; trash/
   retention policies are documented and enforced.
5. Permission matrix controls team/project admin actions; no guest role exists,
   access enterprise settings.
6. Existing login/password, API keys, MCP, agents and sharing keep working,
   with SSO optional; tsc, i18n, agents-md, `check:harness` and build pass.

## Out of scope

- HIPAA/SOC 2 certification, data residency/multi-region, customer-managed
  encryption keys (could follow).
- Custom roles beyond a configurable matrix (start with built-in roles).
- Full IdP group hierarchy sync (flat group→role mapping first).
- Billing/subscription management.
- Organization-level multi-tenancy (one TaCos instance per team is assumed).

## Open decisions

1. SSO: OIDC only in v1 (recommended) or SAML too?
2. Provisioning: domain auto-join first (recommended) or SCIM first?
3. Audit retention default: 90 days (recommended) or longer?
4. Permission matrix scope: team/project actions only (recommended) or full
   custom roles now?
5. Session policy defaults: 30 days absolute, 7 days idle (recommended)?

## Dependencies

- U-05 for exports; U-07 for external agent audit; #77/#80 for key/rule audit.
- U-12 for admin ops pages.

## Files likely touched

- `src/lib/auth.ts`, session/device tables, new SSO/OIDC module.
- New `src/lib/audit.ts`, audit table (append-only), retention sweeps.
- SCIM routes, role mapping; Settings → Security/SSO/Audit/Retention pages.
- `src/lib/i18n/zh.ts`, README, new checks.
