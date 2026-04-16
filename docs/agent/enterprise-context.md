# Enterprise-Aware AI Context

The enterprise assistant experience is an extension of the existing org assistant. It uses the same `AIPanel`, the same `/api/ai/[orgId]/chat` route, and the same org-scoped thread/message/audit persistence.

Enterprise behavior is not global across the app. It should only activate for organizations on the enterprise plan where the current admin context is enterprise-linked and the caller has an enterprise role.

## Activation Criteria

Enterprise context is attached only when all of the following are true:

- The caller is an org admin for the `orgId` on the request.
- `organizations.enterprise_id` is set for that org.
- `user_enterprise_roles` contains a matching role for this user + enterprise.

If any enterprise lookup fails, the request fails closed (503). If enterprise linkage or role is missing, the assistant remains org-scoped.

## Prompt Context Visibility

`buildPromptContext()` always builds org context. When enterprise context is active, enterprise fields are split by sensitivity:

- Enterprise non-billing context (all enterprise roles):
  - enterprise name and slug
  - enterprise alumni totals from `enterprise_alumni_counts`
  - managed org names and slugs
  - operational sub-org slot usage (`free_limit`, `free_remaining`) where role policy allows
- Enterprise billing context (owner and billing_admin only):
  - bucket quantity
  - alumni capacity/remaining
  - billing-derived quota and seat-allocation values

Per-alumni rows are never preloaded into the prompt and remain tool-backed.

## Enterprise Capability Matrix

- `list_enterprise_alumni`: `owner`, `billing_admin`, `org_admin`
- `get_enterprise_stats`: `owner`, `billing_admin`, `org_admin`
- `list_managed_orgs`: `owner`, `billing_admin`, `org_admin`
- Operational free sub-org slot counts: `owner`, `billing_admin`, `org_admin`
- Billing quota/allocation details (`get_enterprise_quota` and equivalent billing-derived fields): `owner`, `billing_admin`

Rationale: `org_admin` can create sub-orgs and the enterprise dashboard already surfaces free-slot operational data. Billing quota/allocation details remain billing-only.

## Response Policy

- The default answer scope is org-only.
- Enterprise-wide answers are valid only when enterprise context is active.
- Billing-restricted asks for non-billing roles should use deterministic deny behavior, not model improvisation.
- Deny responses should not include restricted derived values.
- Mixed prompts should answer allowed portions and deny restricted portions in the same response.
- Non-enterprise organizations should not receive enterprise answers even when prompts include terms like `enterprise`, `quota`, or `managed orgs`.

## UI Behavior

Enterprise pages mount the same `AIPanel` and `AIEdgeTab` used on org pages. The enterprise layout resolves an admin org id and still talks to `/api/ai/[orgId]/chat`, so existing AI tables stay org-scoped.

Starter prompts and enterprise capability hints should only surface in enterprise-eligible contexts.

## Extending This Path

1. Keep the route and persistence layer unchanged.
2. Reuse `enterpriseId` and `enterpriseRole` from `AiOrgContext`.
3. Prefer enterprise views/RPCs over custom aggregation logic.
4. Keep enterprise detail behind tool calls instead of expanding base prompt payloads.
