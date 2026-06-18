---
type: db-table
title: "org_integration_oauth_state"
description: "Postgres table `org_integration_oauth_state`: 7 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, org]
timestamp: 2026-06-17T00:00:00Z
---

# org_integration_oauth_state

Postgres table `org_integration_oauth_state`: 7 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `id` | `string` | no |
| `initiated_at` | `string` | no |
| `organization_id` | `string` | no |
| `provider` | `string` | no |
| `redirect_path` | `string \| null` | yes |
| `used` | `boolean` | no |
| `user_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
