---
type: db-table
title: "linkedin_enrichment_runs"
description: "Postgres table `linkedin_enrichment_runs`: 11 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema, linkedin]
timestamp: 2026-06-17T00:00:00Z
---

# linkedin_enrichment_runs

Postgres table `linkedin_enrichment_runs`: 11 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `alumni_id` | `string \| null` | yes |
| `created_at` | `string` | no |
| `error` | `string \| null` | yes |
| `id` | `string` | no |
| `linkedin_url` | `string` | no |
| `organization_id` | `string \| null` | yes |
| `run_id` | `string` | no |
| `status` | `string` | no |
| `target_kind` | `string` | no |
| `updated_at` | `string` | no |
| `user_id` | `string \| null` | yes |

## Related tables

_No outbound foreign keys._
