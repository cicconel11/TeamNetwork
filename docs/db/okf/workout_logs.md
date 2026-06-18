---
type: db-table
title: "workout_logs"
description: "Postgres table `workout_logs`: 9 columns. References organizations, workouts."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# workout_logs

Postgres table `workout_logs`: 9 columns. References organizations, workouts.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `id` | `string` | no |
| `metrics` | `Json \| null` | yes |
| `notes` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `status` | `string` | no |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |
| `workout_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
- [workouts](./workouts.md)
