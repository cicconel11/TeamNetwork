---
type: db-table
title: "media_items"
description: "Postgres table `media_items`: 28 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# media_items

Postgres table `media_items`: 28 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `description` | `string \| null` | yes |
| `duration_seconds` | `number \| null` | yes |
| `external_url` | `string \| null` | yes |
| `file_name` | `string \| null` | yes |
| `file_size_bytes` | `number \| null` | yes |
| `gallery_sort_order` | `number` | no |
| `height` | `number \| null` | yes |
| `id` | `string` | no |
| `media_type` | `string` | no |
| `mime_type` | `string \| null` | yes |
| `moderated_at` | `string \| null` | yes |
| `moderated_by` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `preview_file_size_bytes` | `number \| null` | yes |
| `preview_storage_path` | `string \| null` | yes |
| `rejection_reason` | `string \| null` | yes |
| `status` | `Database["public"]["Enums"]["media_status"]` | no |
| `storage_path` | `string \| null` | yes |
| `tags` | `string[]` | no |
| `taken_at` | `string \| null` | yes |
| `thumbnail_url` | `string \| null` | yes |
| `title` | `string` | no |
| `updated_at` | `string` | no |
| `uploaded_by` | `string` | no |
| `visibility` | `string` | no |
| `width` | `number \| null` | yes |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
