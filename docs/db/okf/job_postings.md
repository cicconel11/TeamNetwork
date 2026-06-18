---
type: db-table
title: "job_postings"
description: "Postgres table `job_postings`: 17 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# job_postings

Postgres table `job_postings`: 17 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `application_url` | `string \| null` | yes |
| `company` | `string` | no |
| `contact_email` | `string \| null` | yes |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `description` | `string` | no |
| `experience_level` | `string \| null` | yes |
| `expires_at` | `string \| null` | yes |
| `id` | `string` | no |
| `industry` | `string \| null` | yes |
| `is_active` | `boolean` | no |
| `location` | `string \| null` | yes |
| `location_type` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `posted_by` | `string \| null` | yes |
| `title` | `string` | no |
| `updated_at` | `string` | no |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
