---
date: 2026-04-20
topic: enterprise-bulk-org-wizard
---

# Enterprise Bulk Org Creation Wizard

## Problem Frame

Enterprise admins setting up 10+ organizations must repeat a tedious cycle: create org, copy invite link, send to members, wait, repeat. There's no batch workflow, no way to describe org purpose, no pre-assignment of members, and no hard stop when they exceed paid capacity. The current hybrid pricing model has no hard cap on orgs — it just bills more after the free tier, which means admins can accidentally over-provision without realizing the cost impact.

## Requirements

- R1. **Hard org limit enforcement** — When an enterprise admin tries to create orgs that would exceed their `sub_org_quantity`, block them until they upgrade. No soft warnings.
- R2. **Multi-org wizard flow** — A 3-step wizard:
  - Step 1 (Define Orgs): Add multiple orgs with name, slug, description, purpose, and color. Show remaining quota.
  - Step 2 (Assign Members): For each org, assign members from existing enterprise members (move or copy) and/or new emails/CSV.
  - Step 3 (Review & Create): Summary of all orgs, assignments, and quota impact. Confirm to create all atomically.
- R3. **Org purpose field** — New `purpose` text field on organizations, set by admin during creation, visible to members. Distinct from `description` — explains WHY the org exists (e.g., "Connecting Class of 2024 graduates").
- R4. **Member move/copy** — Per-member toggle when assigning existing enterprise members: "Move" removes from current org and adds to new; "Copy" keeps them in both. Cannot move the sole admin out of an org.
- R5. **Quota visibility** — Show clear quota bar throughout the wizard: current usage, remaining capacity, and upgrade CTA when blocked.

## Success Criteria

- Enterprise admin can create 10 orgs with pre-assigned members in a single session without manual invite distribution
- Attempting to exceed `sub_org_quantity` is blocked at both API and DB levels
- All orgs in a batch either create successfully or none do (atomic)
- Member move/copy operations complete correctly with sole-admin guard

## Scope Boundaries

- NOT changing the pricing model itself (buckets, free tier calc, per-org add-on pricing remain the same)
- NOT building a member self-service "request to join" flow (admin-driven only)
- NOT adding bulk org editing/deletion — this is creation only
- CSV upload is for email invites only, not full alumni import (existing `bulk_import_alumni_rich` handles that separately)

## Key Decisions

- **Hard block over soft warning**: Admin must upgrade before creating more orgs. Chosen to prevent accidental over-provisioning and billing surprises.
- **Wizard over batch form**: Step-by-step flow (define → assign → review) chosen over single-page batch form for clarity with complex nested data.
- **Per-member move/copy toggle**: Admin decides per-member rather than a global setting, since some members legitimately belong in multiple orgs.
- **Atomic org creation, non-atomic member assignment**: Org batch creation rolls back entirely on failure. Member assignments are processed after and report per-member results — partial success is acceptable since assignments can be retried.

## Dependencies / Assumptions

- `sub_org_quantity` on `enterprise_subscriptions` must be set for all active enterprises (null = legacy unlimited, which remains allowed)
- Existing `enterprise_invites` system is reused for email invites — no new invite infrastructure
- Enterprise members endpoint assumes `user_organization_roles` accurately reflects current membership

## Outstanding Questions

### Deferred to Planning
- [Affects R2][Technical] Should the wizard page live under `/enterprise/[slug]/organizations/wizard` or under the existing `/app` routes?
- [Affects R4][Needs research] Are there existing member transfer utilities or should move/copy logic be built from scratch?
- [Affects R1][Technical] How to handle legacy enterprises with `sub_org_quantity = null` — should they be migrated to explicit limits or remain unlimited?

## Next Steps

→ `/ce:plan` for structured implementation planning
