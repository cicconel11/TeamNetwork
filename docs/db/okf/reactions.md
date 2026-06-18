---
type: db-table
title: "reactions"
description: "Postgres table `reactions`: 7 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# reactions

Postgres table `reactions`: 7 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `emoji` | `string` | no |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `target_id` | `string` | no |
| `target_kind` | `Database["public"]["Enums"]["reaction_target_kind"]` | no |
| `user_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
