---
type: db-table
title: "ops_events"
description: "Postgres table `ops_events`: 14 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# ops_events

Postgres table `ops_events`: 14 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `app_version` | `string` | no |
| `client_day` | `string` | no |
| `created_at` | `string` | no |
| `device_class` | `string` | no |
| `endpoint_group` | `string \| null` | yes |
| `error_code` | `string \| null` | yes |
| `event_name` | `Database["public"]["Enums"]["ops_event_name"]` | no |
| `http_status` | `number \| null` | yes |
| `id` | `number` | no |
| `org_id` | `string \| null` | yes |
| `platform` | `string` | no |
| `retryable` | `boolean \| null` | yes |
| `route` | `string` | no |
| `session_id` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
