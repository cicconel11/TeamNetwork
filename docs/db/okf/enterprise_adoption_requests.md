---
type: db-table
title: "enterprise_adoption_requests"
description: "Postgres table `enterprise_adoption_requests`: 9 columns. References enterprise_alumni_counts, enterprises, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, enterprise]
timestamp: 2026-06-17T00:00:00Z
---

# enterprise_adoption_requests

Postgres table `enterprise_adoption_requests`: 9 columns. References enterprise_alumni_counts, enterprises, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `enterprise_id` | `string` | no |
| `expires_at` | `string \| null` | yes |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `requested_at` | `string` | no |
| `requested_by` | `string \| null` | yes |
| `responded_at` | `string \| null` | yes |
| `responded_by` | `string \| null` | yes |
| `status` | `string` | no |

## Related tables

- enterprise_alumni_counts (view or external relation)
- [enterprises](./enterprises.md)
- [organizations](./organizations.md)
