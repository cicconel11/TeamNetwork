---
type: db-table
title: "organization_invites"
description: "Postgres table `organization_invites`: 11 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, organization]
timestamp: 2026-06-17T00:00:00Z
---

# organization_invites

Postgres table `organization_invites`: 11 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `code` | `string` | no |
| `created_at` | `string \| null` | yes |
| `created_by_user_id` | `string \| null` | yes |
| `expires_at` | `string \| null` | yes |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `require_approval` | `boolean \| null` | yes |
| `revoked_at` | `string \| null` | yes |
| `role` | `string \| null` | yes |
| `token` | `string \| null` | yes |
| `uses_remaining` | `number \| null` | yes |

## Related tables

- [organizations](./organizations.md)
