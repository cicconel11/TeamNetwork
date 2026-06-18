---
type: db-table
title: "forms"
description: "Postgres table `forms`: 12 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# forms

Postgres table `forms`: 12 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string \| null` | yes |
| `created_by` | `string \| null` | yes |
| `deleted_at` | `string \| null` | yes |
| `description` | `string \| null` | yes |
| `fields` | `Json` | no |
| `form_kind` | `string` | no |
| `id` | `string` | no |
| `is_active` | `boolean \| null` | yes |
| `organization_id` | `string` | no |
| `system_key` | `string \| null` | yes |
| `title` | `string` | no |
| `updated_at` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
