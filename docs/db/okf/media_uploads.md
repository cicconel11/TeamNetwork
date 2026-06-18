---
type: db-table
title: "media_uploads"
description: "Postgres table `media_uploads`: 15 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# media_uploads

Postgres table `media_uploads`: 15 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `entity_id` | `string \| null` | yes |
| `entity_type` | `Database["public"]["Enums"]["media_entity_type"] \| null` | yes |
| `file_name` | `string` | no |
| `file_size` | `number \| null` | yes |
| `finalized_at` | `string \| null` | yes |
| `id` | `string` | no |
| `mime_type` | `string` | no |
| `organization_id` | `string` | no |
| `preview_file_size` | `number \| null` | yes |
| `preview_storage_path` | `string \| null` | yes |
| `status` | `Database["public"]["Enums"]["media_upload_status"]` | no |
| `storage_path` | `string` | no |
| `uploader_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
