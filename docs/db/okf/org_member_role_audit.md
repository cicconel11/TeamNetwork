---
type: db-table
title: "org_member_role_audit"
description: "Postgres table `org_member_role_audit`: 12 columns. References ai_pending_actions, organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema, org]
timestamp: 2026-06-17T00:00:00Z
---

# org_member_role_audit

Postgres table `org_member_role_audit`: 12 columns. References ai_pending_actions, organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `actor_user_id` | `string \| null` | yes |
| `created_at` | `string` | no |
| `id` | `string` | no |
| `new_role` | `Database["public"]["Enums"]["user_role"]` | no |
| `new_status` | `Database["public"]["Enums"]["membership_status"]` | no |
| `organization_id` | `string` | no |
| `pending_action_id` | `string \| null` | yes |
| `previous_role` | `Database["public"]["Enums"]["user_role"]` | no |
| `previous_status` | `Database["public"]["Enums"]["membership_status"]` | no |
| `reason` | `string \| null` | yes |
| `source` | `string` | no |
| `target_user_id` | `string` | no |

## Related tables

- [ai_pending_actions](./ai_pending_actions.md)
- [organizations](./organizations.md)
- [users](./users.md)
