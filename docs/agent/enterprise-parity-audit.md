# Enterprise AI Parity Audit

Tracks UI mutations in the enterprise surface against AI tool coverage. The goal: any action an enterprise user can take from the dashboard, the assistant can also take (subject to role gates and human-in-the-loop confirmation for writes).

Related read capability landed this round: `list_enterprise_audit_events` surfaces `enterprise_audit_logs` + `enterprise_adoption_requests` to any enterprise role. That tool is a read, not a mutation, so it does not appear in the table below.

## Tracked gaps

| UI action | Handler route | Priority | Status | Notes |
|---|---|---|---|---|
| Create enterprise invite | `POST /api/enterprise/[slug]/invites` | P0 | in progress | `prepare_enterprise_invite` + confirm handler this round |
| Revoke enterprise invite | `PATCH /api/enterprise/[slug]/invites/[id]` | P0 | in progress | `revoke_enterprise_invite` + confirm handler this round |
| Update enterprise settings (name, contact) | `PATCH /api/enterprise/[slug]` | P1 | tracked | Owner-only; needs_confirmation pattern |
| Update enterprise branding (logo, colors) | `PATCH /api/enterprise/[slug]/branding` | P2 | tracked | Asset upload adds complexity — defer |
| Invite new enterprise admin | `POST /api/enterprise/[slug]/admins/invites` | P1 | tracked | Distinct from org-scoped invites; role enum owner/billing_admin/org_admin |
| Remove enterprise admin | `DELETE /api/enterprise/[slug]/admins/[userId]` | P1 | tracked | High-risk — double confirmation + owner gate |
| Open Stripe billing portal | `POST /api/enterprise/[slug]/billing/portal` | P2 | tracked | Returns URL — AI should hand off link, not act |
| Adjust alumni bucket quantity | `PATCH /api/enterprise/[slug]/billing/buckets` | P1 | tracked | Stripe subscription mutation; billing_admin+owner |
| Add org seat add-ons | `PATCH /api/enterprise/[slug]/billing/seats` | P1 | tracked | Subscription mutation; billing_admin+owner |
| Bulk invite upload (CSV) | `POST /api/enterprise/[slug]/invites/bulk` | P2 | tracked | File ingestion — lower priority for AI |
| Create managed sub-org | `POST /api/enterprise/[slug]/orgs` | P1 | tracked | Must respect free-sub-org quota + capacity |
| Save navigation config | `PUT /api/enterprise/[slug]/navigation` | P2 | tracked | Complex structured payload; defer |
| Sync navigation to managed orgs | `POST /api/enterprise/[slug]/navigation/sync` | P2 | tracked | Broadcast op — strong confirmation required |
| Export alumni CSV | `GET /api/enterprise/[slug]/alumni/export` | P2 | tracked | Read-export hybrid; AI can describe + link |

## Not planned (excluded by product decision)

Adoption-request mutations are explicitly excluded from the AI surface. These stay human-only because approval decisions carry cross-org financial and capacity implications that should not be executed through an assistant.

| UI action | Handler route | Rationale |
|---|---|---|
| Accept adoption request | `POST /api/enterprise/[slug]/adoption-requests/[id]/accept` | Human-only decision |
| Reject adoption request | `POST /api/enterprise/[slug]/adoption-requests/[id]/reject` | Human-only decision |
| Cancel adoption request (requester side) | `DELETE /api/org/[slug]/adoption-requests/[id]` | Human-only decision |

## Notes on scope

- Pause/resume of managed orgs is not a current UI capability — no `is_paused` column exists.
- All tracked items are expected to follow the `prepare_*` + pending-actions confirmation flow already used by content/chat writes.
- Role gates should mirror the enterprise UI: owner-only vs owner+org_admin vs owner+billing_admin as already encoded in `src/types/enterprise.ts` role presets.
