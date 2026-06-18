---
type: db-table
title: "discussion_replies"
description: "Postgres table `discussion_replies`: 9 columns. References discussion_threads, organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# discussion_replies

Postgres table `discussion_replies`: 9 columns. References discussion_threads, organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `author_id` | `string \| null` | yes |
| `body` | `string` | no |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `id` | `string` | no |
| `mentioned_user_ids` | `string[]` | no |
| `organization_id` | `string` | no |
| `thread_id` | `string` | no |
| `updated_at` | `string` | no |

## Related tables

- [discussion_threads](./discussion_threads.md)
- [organizations](./organizations.md)
- [users](./users.md)
