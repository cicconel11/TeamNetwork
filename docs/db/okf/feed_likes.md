---
type: db-table
title: "feed_likes"
description: "Postgres table `feed_likes`: 5 columns. References feed_posts, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# feed_likes

Postgres table `feed_likes`: 5 columns. References feed_posts, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `post_id` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [feed_posts](./feed_posts.md)
- [organizations](./organizations.md)
