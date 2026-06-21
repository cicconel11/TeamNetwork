---
type: db-table
title: "knowledge_documents"
description: "Postgres table `knowledge_documents`: 14 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# knowledge_documents

Postgres table `knowledge_documents`: 14 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `audience` | `string` | no |
| `body` | `string` | no |
| `created_at` | `string` | no |
| `created_by` | `string \| null` | yes |
| `deleted_at` | `string \| null` | yes |
| `description` | `string \| null` | yes |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `resource` | `string \| null` | yes |
| `source_timestamp` | `string \| null` | yes |
| `tags` | `string[] \| null` | yes |
| `title` | `string` | no |
| `type` | `string \| null` | yes |
| `updated_at` | `string` | no |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
