---
type: db-table
title: "announcements"
description: "Postgres table `announcements`: 14 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# announcements

Postgres table `announcements`: 14 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `audience` | `string \| null` | yes |
| `audience_user_ids` | `string[] \| null` | yes |
| `body` | `string \| null` | yes |
| `created_at` | `string \| null` | yes |
| `created_by_user_id` | `string \| null` | yes |
| `deleted_at` | `string \| null` | yes |
| `id` | `string` | no |
| `is_pinned` | `boolean \| null` | yes |
| `mentioned_user_ids` | `string[]` | no |
| `organization_id` | `string` | no |
| `published_at` | `string \| null` | yes |
| `target_user_ids` | `string[] \| null` | yes |
| `title` | `string` | no |
| `updated_at` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
