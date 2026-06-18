---
type: db-table
title: "chat_groups"
description: "Postgres table `chat_groups`: 11 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, chat]
timestamp: 2026-06-17T00:00:00Z
---

# chat_groups

Postgres table `chat_groups`: 11 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `avatar_url` | `string \| null` | yes |
| `created_at` | `string` | no |
| `created_by` | `string \| null` | yes |
| `deleted_at` | `string \| null` | yes |
| `description` | `string \| null` | yes |
| `id` | `string` | no |
| `is_default` | `boolean` | no |
| `name` | `string` | no |
| `organization_id` | `string` | no |
| `require_approval` | `boolean` | no |
| `updated_at` | `string` | no |

## Related tables

- [organizations](./organizations.md)
