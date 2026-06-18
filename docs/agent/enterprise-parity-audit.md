---
type: audit
title: Enterprise AI Parity Audit
description: Tracks enterprise UI mutations against AI tool coverage and role gates.
resource: apps/web/src/types/enterprise.ts
tags: [ai, enterprise, parity-audit, write-tools]
timestamp: 2026-06-17T00:00:00Z
---

# Enterprise AI Parity Audit

Tracks UI mutations in the enterprise surface against AI tool coverage. The goal: any action an enterprise user can take from the dashboard, the assistant can also take (subject to role gates and human-in-the-loop confirmation for writes).

Related read capability landed this round: `list_enterprise_audit_events` surfaces `enterprise_audit_logs` + `enterprise_adoption_requests` to any enterprise role. That tool is a read, not a mutation, so it does not appear in the table below.

Org-surface CRUD parity for jobs and calendar events is now handled outside this enterprise table via `prepare_update_job_posting`, `prepare_delete_job_posting`, `prepare_update_event`, and `prepare_delete_event`. Enterprise settings, billing, and managed-org mutations remain tracked below.

## Tracked gaps

| UI action | Handler route | Priority | Status | Notes |
|---|---|---|---|---|
| Create enterprise invite | `POST /api/enterprise/[enterpriseId]/invites` | P0 | shipped | `prepare_enterprise_invite` tool module + confirm handler landed |
| Revoke enterprise invite | `PATCH /api/enterprise/[enterpriseId]/invites/[inviteId]` | P0 | shipped | `revoke_enterprise_invite` tool module + confirm handler landed |
| Update enterprise settings (name, contact) | `PATCH /api/enterprise/[enterpriseId]` | P1 | tracked | Owner-only; needs_confirmation pattern |
| Update enterprise branding (logo, colors) | `PATCH /api/enterprise/[enterpriseId]/branding` | P2 | tracked | Asset upload adds complexity — defer |
| Invite new enterprise admin | `POST /api/enterprise/[enterpriseId]/admins/invites` | P1 | tracked | Distinct from org-scoped invites; role enum owner/billing_admin/org_admin |
| Remove enterprise admin | `DELETE /api/enterprise/[enterpriseId]/admins/[userId]` | P1 | tracked | High-risk — double confirmation + owner gate |
| Open Stripe billing portal | `POST /api/enterprise/[enterpriseId]/billing/portal` | P2 | tracked | Returns URL — AI should hand off link, not act |
| Adjust alumni bucket quantity | `PATCH /api/enterprise/[enterpriseId]/billing/adjust` | P1 | tracked | Stripe subscription mutation; billing_admin+owner (bucket + seat adjustments share the `billing/adjust` route) |
| Add org seat add-ons | `PATCH /api/enterprise/[enterpriseId]/billing/adjust` | P1 | tracked | Subscription mutation; billing_admin+owner (shares `billing/adjust` with bucket changes) |
| Bulk invite upload (CSV) | `POST /api/enterprise/[enterpriseId]/invites/bulk` | P2 | tracked | File ingestion — lower priority for AI |
| Create managed sub-org | `POST /api/enterprise/[enterpriseId]/orgs` | P1 | tracked | Must respect free-sub-org quota + capacity |
| Save navigation config | `PUT /api/enterprise/[enterpriseId]/navigation` | P2 | tracked | Complex structured payload; defer |
| Sync navigation to managed orgs | `POST /api/enterprise/[enterpriseId]/navigation/sync` | P2 | tracked | Broadcast op — strong confirmation required |
| Export alumni CSV | `GET /api/enterprise/[enterpriseId]/alumni/export` | P2 | tracked | Read-export hybrid; AI can describe + link |

## Not planned (excluded by product decision)

Adoption-request mutations are explicitly excluded from the AI surface. These stay human-only because approval decisions carry cross-org financial and capacity implications that should not be executed through an assistant.

| UI action | Handler route | Rationale |
|---|---|---|
| Accept adoption request | `POST /api/enterprise/[enterpriseId]/adoption-requests/[id]/accept` | Human-only decision |
| Reject adoption request | `POST /api/enterprise/[enterpriseId]/adoption-requests/[id]/reject` | Human-only decision |
| Cancel adoption request (requester side) | `DELETE /api/org/[slug]/adoption-requests/[id]` | Human-only decision |

## Notes on scope

- Pause/resume of managed orgs is not a current UI capability — no `is_paused` column exists.
- All tracked items are expected to follow the `prepare_*` + pending-actions confirmation flow already used by content/chat writes.
- Role gates should mirror the enterprise UI: owner-only vs owner+org_admin vs owner+billing_admin as already encoded in `src/types/enterprise.ts` role presets.
