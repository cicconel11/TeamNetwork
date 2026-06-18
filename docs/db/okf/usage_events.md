---
type: db-table
title: "usage_events"
description: "Postgres table `usage_events`: 10 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# usage_events

Postgres table `usage_events`: 10 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `device_class` | `string \| null` | yes |
| `duration_ms` | `number \| null` | yes |
| `event_type` | `string` | no |
| `feature` | `string` | no |
| `hour_of_day` | `number \| null` | yes |
| `id` | `string` | no |
| `organization_id` | `string \| null` | yes |
| `session_id` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
