---
type: db-table
title: "member_streaks"
description: "Postgres table `member_streaks`: 8 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# member_streaks

Postgres table `member_streaks`: 8 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `current_weeks` | `number` | no |
| `last_qualifying_week_start` | `string \| null` | yes |
| `last_recomputed_at` | `string` | no |
| `longest_weeks` | `number` | no |
| `organization_id` | `string` | no |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
