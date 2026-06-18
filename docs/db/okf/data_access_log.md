---
type: db-table
title: "data_access_log"
description: "Postgres table `data_access_log`: 8 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# data_access_log

Postgres table `data_access_log`: 8 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `accessed_at` | `string` | no |
| `actor_user_id` | `string \| null` | yes |
| `id` | `string` | no |
| `ip_hash` | `string \| null` | yes |
| `organization_id` | `string \| null` | yes |
| `resource_id` | `string \| null` | yes |
| `resource_type` | `string` | no |
| `user_agent` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
