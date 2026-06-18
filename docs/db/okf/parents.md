---
type: db-table
title: "parents"
description: "Postgres table `parents`: 29 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# parents

Postgres table `parents`: 29 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `certifications` | `Json \| null` | yes |
| `created_at` | `string` | no |
| `current_city` | `string \| null` | yes |
| `current_company` | `string \| null` | yes |
| `deleted_at` | `string \| null` | yes |
| `education_history` | `Json \| null` | yes |
| `email` | `string \| null` | yes |
| `first_name` | `string` | no |
| `headline` | `string \| null` | yes |
| `id` | `string` | no |
| `industry` | `string \| null` | yes |
| `job_title` | `string \| null` | yes |
| `languages` | `Json \| null` | yes |
| `last_name` | `string` | no |
| `linkedin_url` | `string \| null` | yes |
| `major` | `string \| null` | yes |
| `notes` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `phone_number` | `string \| null` | yes |
| `photo_url` | `string \| null` | yes |
| `position_title` | `string \| null` | yes |
| `relationship` | `string \| null` | yes |
| `school` | `string \| null` | yes |
| `skills` | `Json \| null` | yes |
| `student_name` | `string \| null` | yes |
| `summary` | `string \| null` | yes |
| `updated_at` | `string` | no |
| `user_id` | `string \| null` | yes |
| `work_history` | `Json \| null` | yes |

## Related tables

- [organizations](./organizations.md)
