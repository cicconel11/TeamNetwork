---
type: db-table
title: "competitions"
description: "Postgres table `competitions`: 6 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# competitions

Postgres table `competitions`: 6 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string \| null` | yes |
| `description` | `string \| null` | yes |
| `id` | `string` | no |
| `name` | `string` | no |
| `organization_id` | `string` | no |
| `season` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
