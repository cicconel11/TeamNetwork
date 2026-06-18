---
type: db-table
title: "feed_posts"
description: "Postgres table `feed_posts`: 11 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# feed_posts

Postgres table `feed_posts`: 11 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `author_id` | `string` | no |
| `body` | `string` | no |
| `comment_count` | `number` | no |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `id` | `string` | no |
| `like_count` | `number` | no |
| `metadata` | `Json \| null` | yes |
| `organization_id` | `string` | no |
| `post_type` | `string` | no |
| `updated_at` | `string` | no |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
