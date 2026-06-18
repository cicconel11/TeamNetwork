---
type: db-table
title: "notification_jobs"
description: "Postgres table `notification_jobs`: 19 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, notification]
timestamp: 2026-06-17T00:00:00Z
---

# notification_jobs

Postgres table `notification_jobs`: 19 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `attempts` | `number` | no |
| `audience` | `string \| null` | yes |
| `body` | `string \| null` | yes |
| `category` | `string \| null` | yes |
| `created_at` | `string` | no |
| `data` | `Json` | no |
| `id` | `string` | no |
| `kind` | `string` | no |
| `last_error` | `string \| null` | yes |
| `leased_at` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `priority` | `number` | no |
| `push_resource_id` | `string \| null` | yes |
| `push_type` | `string \| null` | yes |
| `scheduled_for` | `string` | no |
| `sent_at` | `string \| null` | yes |
| `status` | `string` | no |
| `target_user_ids` | `string[] \| null` | yes |
| `title` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
