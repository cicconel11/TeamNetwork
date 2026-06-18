---
type: db-table
title: "user_calendar_connections"
description: "Postgres table `user_calendar_connections`: 14 columns. References users."
resource: /apps/web/src/types/database.ts
tags: [db, schema, user]
timestamp: 2026-06-17T00:00:00Z
---

# user_calendar_connections

Postgres table `user_calendar_connections`: 14 columns. References users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `access_token_encrypted` | `string` | no |
| `created_at` | `string \| null` | yes |
| `id` | `string` | no |
| `last_sync_at` | `string \| null` | yes |
| `microsoft_refresh_lock_expires_at` | `string \| null` | yes |
| `microsoft_refresh_lock_id` | `string \| null` | yes |
| `provider` | `string` | no |
| `provider_email` | `string` | no |
| `refresh_token_encrypted` | `string` | no |
| `status` | `string` | no |
| `target_calendar_id` | `string \| null` | yes |
| `token_expires_at` | `string` | no |
| `updated_at` | `string \| null` | yes |
| `user_id` | `string` | no |

## Related tables

- [users](./users.md)
