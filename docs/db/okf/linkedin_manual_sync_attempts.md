---
type: db-table
title: "linkedin_manual_sync_attempts"
description: "Postgres table `linkedin_manual_sync_attempts`: 8 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema, linkedin]
timestamp: 2026-06-17T00:00:00Z
---

# linkedin_manual_sync_attempts

Postgres table `linkedin_manual_sync_attempts`: 8 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `completed_at` | `string \| null` | yes |
| `created_at` | `string` | no |
| `id` | `string` | no |
| `month_key` | `string` | no |
| `released_at` | `string \| null` | yes |
| `status` | `string` | no |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |

## Related tables

_No outbound foreign keys._
