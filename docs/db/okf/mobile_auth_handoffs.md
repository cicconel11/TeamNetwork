---
type: db-table
title: "mobile_auth_handoffs"
description: "Postgres table `mobile_auth_handoffs`: 8 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# mobile_auth_handoffs

Postgres table `mobile_auth_handoffs`: 8 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `code_hash` | `string` | no |
| `consumed_at` | `string \| null` | yes |
| `created_at` | `string` | no |
| `encrypted_access_token` | `string` | no |
| `encrypted_refresh_token` | `string` | no |
| `expires_at` | `string` | no |
| `id` | `string` | no |
| `user_id` | `string` | no |

## Related tables

_No outbound foreign keys._
