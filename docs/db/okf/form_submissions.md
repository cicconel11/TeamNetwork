---
type: db-table
title: "form_submissions"
description: "Postgres table `form_submissions`: 7 columns. References forms, organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema, form]
timestamp: 2026-06-17T00:00:00Z
---

# form_submissions

Postgres table `form_submissions`: 7 columns. References forms, organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `data` | `Json` | no |
| `deleted_at` | `string \| null` | yes |
| `form_id` | `string` | no |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `submitted_at` | `string \| null` | yes |
| `user_id` | `string \| null` | yes |

## Related tables

- [forms](./forms.md)
- [organizations](./organizations.md)
- [users](./users.md)
