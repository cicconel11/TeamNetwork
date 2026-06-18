---
type: db-table
title: "media_albums"
description: "Postgres table `media_albums`: 12 columns. References media_items, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# media_albums

Postgres table `media_albums`: 12 columns. References media_items, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `cover_media_id` | `string \| null` | yes |
| `created_at` | `string` | no |
| `created_by` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `description` | `string \| null` | yes |
| `id` | `string` | no |
| `is_upload_draft` | `boolean` | no |
| `item_count` | `number` | no |
| `name` | `string` | no |
| `organization_id` | `string` | no |
| `sort_order` | `number` | no |
| `updated_at` | `string` | no |

## Related tables

- [media_items](./media_items.md)
- [organizations](./organizations.md)
