---
type: db-table
title: "workouts"
description: "Postgres table `workouts`: 9 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# workouts

Postgres table `workouts`: 9 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `created_by` | `string \| null` | yes |
| `description` | `string \| null` | yes |
| `external_url` | `string \| null` | yes |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `title` | `string` | no |
| `updated_at` | `string` | no |
| `workout_date` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
