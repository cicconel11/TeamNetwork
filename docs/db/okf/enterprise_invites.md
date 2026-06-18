---
type: db-table
title: "enterprise_invites"
description: "Postgres table `enterprise_invites`: 11 columns. References enterprise_alumni_counts, enterprises, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, enterprise]
timestamp: 2026-06-17T00:00:00Z
---

# enterprise_invites

Postgres table `enterprise_invites`: 11 columns. References enterprise_alumni_counts, enterprises, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `code` | `string` | no |
| `created_at` | `string` | no |
| `created_by_user_id` | `string \| null` | yes |
| `enterprise_id` | `string` | no |
| `expires_at` | `string \| null` | yes |
| `id` | `string` | no |
| `organization_id` | `string \| null` | yes |
| `revoked_at` | `string \| null` | yes |
| `role` | `string` | no |
| `token` | `string` | no |
| `uses_remaining` | `number \| null` | yes |

## Related tables

- enterprise_alumni_counts (view or external relation)
- [enterprises](./enterprises.md)
- [organizations](./organizations.md)
