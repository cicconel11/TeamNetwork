---
type: db-table
title: "members"
description: "Postgres table `members`: 30 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# members

Postgres table `members`: 30 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `bio` | `string \| null` | yes |
| `certifications` | `Json \| null` | yes |
| `created_at` | `string \| null` | yes |
| `current_city` | `string \| null` | yes |
| `current_company` | `string \| null` | yes |
| `deleted_at` | `string \| null` | yes |
| `education_history` | `Json \| null` | yes |
| `email` | `string \| null` | yes |
| `expected_graduation_date` | `string \| null` | yes |
| `first_name` | `string` | no |
| `graduated_at` | `string \| null` | yes |
| `graduation_warning_sent_at` | `string \| null` | yes |
| `graduation_year` | `number \| null` | yes |
| `headline` | `string \| null` | yes |
| `id` | `string` | no |
| `industry` | `string \| null` | yes |
| `languages` | `Json \| null` | yes |
| `last_name` | `string` | no |
| `linkedin_url` | `string \| null` | yes |
| `major` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `photo_url` | `string \| null` | yes |
| `role` | `string \| null` | yes |
| `school` | `string \| null` | yes |
| `skills` | `Json \| null` | yes |
| `status` | `Database["public"]["Enums"]["member_status"] \| null` | yes |
| `summary` | `string \| null` | yes |
| `updated_at` | `string \| null` | yes |
| `user_id` | `string \| null` | yes |
| `work_history` | `Json \| null` | yes |

## Related tables

- [organizations](./organizations.md)
