---
type: db-table
title: "schedule_files"
description: "Postgres table `schedule_files`: 9 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# schedule_files

Postgres table `schedule_files`: 9 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string \| null` | yes |
| `deleted_at` | `string \| null` | yes |
| `file_name` | `string` | no |
| `file_path` | `string` | no |
| `file_size` | `number \| null` | yes |
| `id` | `string` | no |
| `mime_type` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
