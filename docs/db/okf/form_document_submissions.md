---
type: db-table
title: "form_document_submissions"
description: "Postgres table `form_document_submissions`: 10 columns. References form_documents, organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema, form]
timestamp: 2026-06-17T00:00:00Z
---

# form_document_submissions

Postgres table `form_document_submissions`: 10 columns. References form_documents, organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `deleted_at` | `string \| null` | yes |
| `document_id` | `string` | no |
| `file_name` | `string` | no |
| `file_path` | `string` | no |
| `file_size` | `number \| null` | yes |
| `id` | `string` | no |
| `mime_type` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `submitted_at` | `string \| null` | yes |
| `user_id` | `string` | no |

## Related tables

- [form_documents](./form_documents.md)
- [organizations](./organizations.md)
- [users](./users.md)
