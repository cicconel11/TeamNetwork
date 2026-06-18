---
type: db-table
title: "ai_spend_ledger"
description: "Postgres table `ai_spend_ledger`: 7 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, ai]
timestamp: 2026-06-17T00:00:00Z
---

# ai_spend_ledger

Postgres table `ai_spend_ledger`: 7 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `id` | `string` | no |
| `org_id` | `string` | no |
| `period_start` | `string` | no |
| `request_count` | `number` | no |
| `spend_microusd` | `number` | no |
| `updated_at` | `string` | no |

## Related tables

- [organizations](./organizations.md)
