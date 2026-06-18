---
type: db-table
title: "content_reports"
description: "Postgres table `content_reports`: 13 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# content_reports

Postgres table `content_reports`: 13 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `details` | `string \| null` | yes |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `reason` | `string` | no |
| `reported_user_id` | `string \| null` | yes |
| `reporter_id` | `string \| null` | yes |
| `reviewed_at` | `string \| null` | yes |
| `reviewed_by` | `string \| null` | yes |
| `status` | `string` | no |
| `target_id` | `string` | no |
| `target_type` | `string` | no |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
