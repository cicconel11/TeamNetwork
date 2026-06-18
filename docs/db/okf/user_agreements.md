---
type: db-table
title: "user_agreements"
description: "Postgres table `user_agreements`: 6 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema, user]
timestamp: 2026-06-17T00:00:00Z
---

# user_agreements

Postgres table `user_agreements`: 6 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `accepted_at` | `string` | no |
| `agreement_type` | `Database["public"]["Enums"]["agreement_type"]` | no |
| `id` | `string` | no |
| `ip_hash` | `string \| null` | yes |
| `user_id` | `string` | no |
| `version` | `string` | no |

## Related tables

_No outbound foreign keys._
