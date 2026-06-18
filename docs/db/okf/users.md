---
type: db-table
title: "users"
description: "Postgres table `users`: 7 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# users

Postgres table `users`: 7 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `avatar_url` | `string \| null` | yes |
| `created_at` | `string \| null` | yes |
| `email` | `string` | no |
| `id` | `string` | no |
| `language_override` | `string \| null` | yes |
| `last_active_at` | `string \| null` | yes |
| `name` | `string \| null` | yes |

## Related tables

_No outbound foreign keys._
