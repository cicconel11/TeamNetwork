---
type: db-table
title: "usage_summaries"
description: "Postgres table `usage_summaries`: 12 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# usage_summaries

Postgres table `usage_summaries`: 12 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `device_preference` | `string \| null` | yes |
| `feature` | `string` | no |
| `id` | `string` | no |
| `last_visited_at` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `peak_hour` | `number \| null` | yes |
| `period_end` | `string` | no |
| `period_start` | `string` | no |
| `total_duration_ms` | `number` | no |
| `user_id` | `string` | no |
| `visit_count` | `number` | no |

## Related tables

- [organizations](./organizations.md)
