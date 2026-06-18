---
type: db-table
title: "user_deletion_requests"
description: "Postgres table `user_deletion_requests`: 9 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema, user]
timestamp: 2026-06-17T00:00:00Z
---

# user_deletion_requests

Postgres table `user_deletion_requests`: 9 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `cancelled_at` | `string \| null` | yes |
| `completed_at` | `string \| null` | yes |
| `created_at` | `string` | no |
| `id` | `string` | no |
| `requested_at` | `string` | no |
| `scheduled_deletion_at` | `string` | no |
| `status` | `string` | no |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |

## Related tables

_No outbound foreign keys._
