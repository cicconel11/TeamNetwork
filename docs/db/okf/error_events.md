---
type: db-table
title: "error_events"
description: "Postgres table `error_events`: 11 columns. References error_groups."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# error_events

Postgres table `error_events`: 11 columns. References error_groups.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `api_path` | `string \| null` | yes |
| `created_at` | `string` | no |
| `env` | `string` | no |
| `group_id` | `string` | no |
| `id` | `string` | no |
| `message` | `string` | no |
| `meta` | `Json` | no |
| `route` | `string \| null` | yes |
| `session_id` | `string \| null` | yes |
| `stack` | `string \| null` | yes |
| `user_id` | `string \| null` | yes |

## Related tables

- [error_groups](./error_groups.md)
