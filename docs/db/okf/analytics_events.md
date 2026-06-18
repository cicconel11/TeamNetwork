---
type: db-table
title: "analytics_events"
description: "Postgres table `analytics_events`: 11 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# analytics_events

Postgres table `analytics_events`: 11 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `app_version` | `string` | no |
| `client_day` | `string` | no |
| `created_at` | `string` | no |
| `device_class` | `string` | no |
| `event_name` | `Database["public"]["Enums"]["analytics_event_name"]` | no |
| `id` | `number` | no |
| `org_id` | `string` | no |
| `platform` | `string` | no |
| `props` | `Json` | no |
| `route` | `string` | no |
| `session_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
