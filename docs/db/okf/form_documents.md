---
type: db-table
title: "form_documents"
description: "Postgres table `form_documents`: 13 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema, form]
timestamp: 2026-06-17T00:00:00Z
---

# form_documents

Postgres table `form_documents`: 13 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string \| null` | yes |
| `created_by` | `string \| null` | yes |
| `deleted_at` | `string \| null` | yes |
| `description` | `string \| null` | yes |
| `file_name` | `string` | no |
| `file_path` | `string` | no |
| `file_size` | `number \| null` | yes |
| `id` | `string` | no |
| `is_active` | `boolean \| null` | yes |
| `mime_type` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `title` | `string` | no |
| `updated_at` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
