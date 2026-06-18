---
type: db-table
title: "analytics_ops_events"
description: "Postgres table `analytics_ops_events`: 13 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# analytics_ops_events

Postgres table `analytics_ops_events`: 13 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `app_version` | `string` | no |
| `client_day` | `string` | no |
| `consent_state` | `string` | no |
| `created_at` | `string` | no |
| `device_class` | `string` | no |
| `event_name` | `string` | no |
| `id` | `string` | no |
| `organization_id` | `string \| null` | yes |
| `payload` | `Json` | no |
| `platform` | `string` | no |
| `referrer_type` | `string` | no |
| `route` | `string` | no |
| `session_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
