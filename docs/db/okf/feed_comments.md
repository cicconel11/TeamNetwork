---
type: db-table
title: "feed_comments"
description: "Postgres table `feed_comments`: 8 columns. References feed_posts, organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# feed_comments

Postgres table `feed_comments`: 8 columns. References feed_posts, organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `author_id` | `string` | no |
| `body` | `string` | no |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `post_id` | `string` | no |
| `updated_at` | `string` | no |

## Related tables

- [feed_posts](./feed_posts.md)
- [organizations](./organizations.md)
- [users](./users.md)
