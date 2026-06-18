---
type: db-table
title: "notifications"
description: "Postgres table `notifications`: 14 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# notifications

Postgres table `notifications`: 14 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `audience` | `string` | no |
| `body` | `string \| null` | yes |
| `channel` | `string` | no |
| `created_at` | `string \| null` | yes |
| `created_by_user_id` | `string \| null` | yes |
| `data` | `Json` | no |
| `deleted_at` | `string \| null` | yes |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `resource_id` | `string \| null` | yes |
| `sent_at` | `string \| null` | yes |
| `target_user_ids` | `string[] \| null` | yes |
| `title` | `string` | no |
| `type` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
