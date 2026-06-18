---
type: db-table
title: "competition_teams"
description: "Postgres table `competition_teams`: 6 columns. References competitions, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# competition_teams

Postgres table `competition_teams`: 6 columns. References competitions, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `competition_id` | `string` | no |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `id` | `string` | no |
| `name` | `string` | no |
| `organization_id` | `string` | no |

## Related tables

- [competitions](./competitions.md)
- [organizations](./organizations.md)
