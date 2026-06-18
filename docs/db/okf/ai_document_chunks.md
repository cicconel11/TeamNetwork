---
type: db-table
title: "ai_document_chunks"
description: "Postgres table `ai_document_chunks`: 12 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, ai]
timestamp: 2026-06-17T00:00:00Z
---

# ai_document_chunks

Postgres table `ai_document_chunks`: 12 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `chunk_index` | `number` | no |
| `content_hash` | `string` | no |
| `content_text` | `string` | no |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `embedding` | `string \| null` | yes |
| `id` | `string` | no |
| `metadata` | `Json` | no |
| `org_id` | `string` | no |
| `source_id` | `string` | no |
| `source_table` | `string` | no |
| `updated_at` | `string` | no |

## Related tables

- [organizations](./organizations.md)
