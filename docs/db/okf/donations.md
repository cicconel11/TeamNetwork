---
type: db-table
title: "donations"
description: "Postgres table `donations`: 10 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# donations

Postgres table `donations`: 10 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `amount` | `number` | no |
| `campaign` | `string \| null` | yes |
| `created_at` | `string \| null` | yes |
| `date` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `donor_email` | `string \| null` | yes |
| `donor_name` | `string` | no |
| `id` | `string` | no |
| `notes` | `string \| null` | yes |
| `organization_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
