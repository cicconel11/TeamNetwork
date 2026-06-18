---
type: db-table
title: "academic_schedules"
description: "Postgres table `academic_schedules`: 15 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# academic_schedules

Postgres table `academic_schedules`: 15 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string \| null` | yes |
| `day_of_month` | `number \| null` | yes |
| `day_of_week` | `number[] \| null` | yes |
| `deleted_at` | `string \| null` | yes |
| `end_date` | `string \| null` | yes |
| `end_time` | `string` | no |
| `id` | `string` | no |
| `notes` | `string \| null` | yes |
| `occurrence_type` | `string` | no |
| `organization_id` | `string` | no |
| `start_date` | `string` | no |
| `start_time` | `string` | no |
| `title` | `string` | no |
| `updated_at` | `string \| null` | yes |
| `user_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
