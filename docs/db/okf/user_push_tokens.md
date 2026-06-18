---
type: db-table
title: "user_push_tokens"
description: "Postgres table `user_push_tokens`: 7 columns. References users."
resource: /apps/web/src/types/database.ts
tags: [db, schema, user]
timestamp: 2026-06-17T00:00:00Z
---

# user_push_tokens

Postgres table `user_push_tokens`: 7 columns. References users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string \| null` | yes |
| `device_id` | `string \| null` | yes |
| `expo_push_token` | `string` | no |
| `id` | `string` | no |
| `platform` | `string` | no |
| `updated_at` | `string \| null` | yes |
| `user_id` | `string` | no |

## Related tables

- [users](./users.md)
