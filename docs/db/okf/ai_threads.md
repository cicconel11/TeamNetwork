---
type: db-table
title: "ai_threads"
description: "Postgres table `ai_threads`: 9 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, ai]
timestamp: 2026-06-17T00:00:00Z
---

# ai_threads

Postgres table `ai_threads`: 9 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `id` | `string` | no |
| `metadata` | `Json` | no |
| `org_id` | `string` | no |
| `surface` | `string` | no |
| `title` | `string \| null` | yes |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
