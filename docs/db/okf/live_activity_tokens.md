---
type: db-table
title: "live_activity_tokens"
description: "Postgres table `live_activity_tokens`: 11 columns. References events, organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# live_activity_tokens

Postgres table `live_activity_tokens`: 11 columns. References events, organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `activity_id` | `string` | no |
| `created_at` | `string` | no |
| `device_id` | `string` | no |
| `ended_at` | `string \| null` | yes |
| `ends_at` | `string` | no |
| `event_id` | `string` | no |
| `organization_id` | `string` | no |
| `push_token` | `string` | no |
| `started_at` | `string` | no |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [events](./events.md)
- [organizations](./organizations.md)
- [users](./users.md)
