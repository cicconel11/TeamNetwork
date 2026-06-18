---
type: db-table
title: "media_album_items"
description: "Postgres table `media_album_items`: 5 columns. References media_albums, media_items."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# media_album_items

Postgres table `media_album_items`: 5 columns. References media_albums, media_items.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `added_at` | `string` | no |
| `album_id` | `string` | no |
| `id` | `string` | no |
| `media_item_id` | `string` | no |
| `sort_order` | `number` | no |

## Related tables

- [media_albums](./media_albums.md)
- [media_items](./media_items.md)
