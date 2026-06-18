---
type: db-table
title: "records"
description: "Postgres table `records`: 10 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# records

Postgres table `records`: 10 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `category` | `string \| null` | yes |
| `created_at` | `string \| null` | yes |
| `deleted_at` | `string \| null` | yes |
| `holder_name` | `string` | no |
| `id` | `string` | no |
| `notes` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `title` | `string` | no |
| `value` | `string` | no |
| `year` | `number \| null` | yes |

## Related tables

- [organizations](./organizations.md)
