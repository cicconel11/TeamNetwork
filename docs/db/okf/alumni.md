---
type: db-table
title: "alumni"
description: "Postgres table `alumni`: 37 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, alumni]
timestamp: 2026-06-17T00:00:00Z
---

# alumni

Postgres table `alumni`: 37 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `address_summary` | `string \| null` | yes |
| `birth_year` | `number \| null` | yes |
| `certifications` | `Json \| null` | yes |
| `created_at` | `string \| null` | yes |
| `current_city` | `string \| null` | yes |
| `current_company` | `string \| null` | yes |
| `deleted_at` | `string \| null` | yes |
| `education_history` | `Json \| null` | yes |
| `email` | `string \| null` | yes |
| `enriched_at` | `string \| null` | yes |
| `enrichment_error` | `string \| null` | yes |
| `enrichment_filled_fields` | `string[] \| null` | yes |
| `enrichment_retry_count` | `number \| null` | yes |
| `enrichment_snapshot_id` | `string \| null` | yes |
| `enrichment_status` | `string \| null` | yes |
| `first_name` | `string` | no |
| `graduation_year` | `number \| null` | yes |
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
| `school` | `string \| null` | yes |
| `skills` | `Json \| null` | yes |
| `source` | `string` | no |
| `summary` | `string \| null` | yes |
| `updated_at` | `string \| null` | yes |
| `user_id` | `string \| null` | yes |
| `work_history` | `Json \| null` | yes |

## Related tables

- [organizations](./organizations.md)
