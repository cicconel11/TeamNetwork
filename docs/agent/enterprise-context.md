# Enterprise-Aware AI Context

The assistant on enterprise pages is the same assistant that already powers org admin pages. It still uses `AIPanel` and the existing `/api/ai/[orgId]/chat` route. There is no separate enterprise agent, no new persistence path, and no schema change.

## How context attaches

`getAiOrgContext()` now keeps the existing org-admin check and, when that org belongs to an enterprise, also checks `user_enterprise_roles` for the same user. If both conditions hold, the AI request context carries:

- `enterpriseId`
- `enterpriseRole` (typed as `EnterpriseRole`: `owner | billing_admin | org_admin`)

Org-only threads keep working unchanged because those fields stay `undefined`.

Both enterprise lookups (`organizations.enterprise_id` and `user_enterprise_roles`) are fail-closed — a DB error on either query returns 503, matching the main org-role check. Transient lookup failures never silently strip enterprise capabilities.

## Prompt behavior

`buildPromptContext()` still builds org context first. When `enterpriseId` is present, it also loads lightweight enterprise grounding:

- enterprise name and slug
- enterprise alumni totals from `enterprise_alumni_counts`
- quota snapshot derived from `enterprise_subscriptions` plus `buildQuotaInfo()`
- managed org names and slugs

This data is injected as untrusted prompt context. Per-alumni rows are not preloaded into the prompt.

## Enterprise tools

The existing tool registry now includes four read-only enterprise tools:

- `list_enterprise_alumni`
- `get_enterprise_stats`
- `list_managed_orgs`
- `get_enterprise_quota`

All four tools short-circuit with a clear error when the current thread has no enterprise context. That lets the same tool registry stay attached without creating a parallel execution pipeline.

Role gating in the executor:

- `get_enterprise_quota` requires `canManageBilling` (owner or billing_admin) via `getEnterprisePermissions()`. Org-admin enterprise users receive a clear tool error.
- The other three tools (`list_enterprise_alumni`, `get_enterprise_stats`, `list_managed_orgs`) are allowed for any enterprise role since all roles have `canViewDashboard`.

## UI behavior

Enterprise pages now mount the same `AIPanel` and `AIEdgeTab` used on org pages. The panel still talks to `/api/ai/[orgId]/chat`; on enterprise pages the `orgId` passed in is the first active admin org the current enterprise user has inside that enterprise. Threads, messages, and audit rows therefore remain stored under the existing org-scoped AI tables.

## Extending this path

When adding more enterprise-aware tools:

1. Keep the route and persistence layer unchanged.
2. Reuse `enterpriseId` from `AiOrgContext`.
3. Prefer enterprise views/RPCs over custom aggregation logic.
4. Keep enterprise detail behind tool calls, not in the base prompt.
