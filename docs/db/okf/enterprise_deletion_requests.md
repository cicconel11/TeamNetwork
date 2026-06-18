---
type: db-table
title: "enterprise_deletion_requests"
description: "Postgres table `enterprise_deletion_requests`: 8 columns. References enterprise_alumni_counts, enterprises."
resource: /apps/web/src/types/database.ts
tags: [db, schema, enterprise]
timestamp: 2026-06-17T00:00:00Z
---

# enterprise_deletion_requests

Postgres table `enterprise_deletion_requests`: 8 columns. References enterprise_alumni_counts, enterprises.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `cancelled_at` | `string \| null` | yes |
| `completed_at` | `string \| null` | yes |
| `enterprise_id` | `string` | no |
| `id` | `string` | no |
| `requested_at` | `string` | no |
| `requested_by` | `string \| null` | yes |
| `scheduled_deletion_at` | `string` | no |
| `status` | `string` | no |

## Related tables

- enterprise_alumni_counts (view or external relation)
- [enterprises](./enterprises.md)
