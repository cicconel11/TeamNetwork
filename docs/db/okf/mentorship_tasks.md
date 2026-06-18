---
type: db-table
title: "mentorship_tasks"
description: "Postgres table `mentorship_tasks`: 11 columns. References mentorship_pairs, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, mentorship]
timestamp: 2026-06-17T00:00:00Z
---

# mentorship_tasks

Postgres table `mentorship_tasks`: 11 columns. References mentorship_pairs, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `created_by` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `description` | `string \| null` | yes |
| `due_date` | `string \| null` | yes |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `pair_id` | `string` | no |
| `status` | `string` | no |
| `title` | `string` | no |
| `updated_at` | `string` | no |

## Related tables

- [mentorship_pairs](./mentorship_pairs.md)
- [organizations](./organizations.md)
