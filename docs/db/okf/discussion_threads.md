---
type: db-table
title: "discussion_threads"
description: "Postgres table `discussion_threads`: 12 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# discussion_threads

Postgres table `discussion_threads`: 12 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `author_id` | `string \| null` | yes |
| `body` | `string` | no |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `id` | `string` | no |
| `is_locked` | `boolean` | no |
| `is_pinned` | `boolean` | no |
| `last_activity_at` | `string` | no |
| `organization_id` | `string` | no |
| `reply_count` | `number` | no |
| `title` | `string` | no |
| `updated_at` | `string` | no |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
