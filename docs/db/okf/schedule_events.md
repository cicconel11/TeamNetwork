---
type: db-table
title: "schedule_events"
description: "Postgres table `schedule_events`: 12 columns. References organizations, schedule_sources."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# schedule_events

Postgres table `schedule_events`: 12 columns. References organizations, schedule_sources.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string \| null` | yes |
| `end_at` | `string` | no |
| `external_uid` | `string` | no |
| `id` | `string` | no |
| `location` | `string \| null` | yes |
| `org_id` | `string` | no |
| `raw` | `Json` | no |
| `source_id` | `string` | no |
| `start_at` | `string` | no |
| `status` | `string` | no |
| `title` | `string` | no |
| `updated_at` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
- [schedule_sources](./schedule_sources.md)
