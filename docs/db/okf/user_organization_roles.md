---
type: db-table
title: "user_organization_roles"
description: "Postgres table `user_organization_roles`: 7 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema, user]
timestamp: 2026-06-17T00:00:00Z
---

# user_organization_roles

Postgres table `user_organization_roles`: 7 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string \| null` | yes |
| `feed_last_seen_at` | `string \| null` | yes |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `role` | `Database["public"]["Enums"]["user_role"]` | no |
| `status` | `Database["public"]["Enums"]["membership_status"]` | no |
| `user_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
