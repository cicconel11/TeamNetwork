---
type: db-table
title: "expenses"
description: "Postgres table `expenses`: 10 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# expenses

Postgres table `expenses`: 10 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `amount` | `number` | no |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `expense_type` | `string` | no |
| `id` | `string` | no |
| `name` | `string` | no |
| `organization_id` | `string` | no |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |
| `venmo_link` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
