---
type: db-table
title: "rate_limit_analytics"
description: "Postgres table `rate_limit_analytics`: 6 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# rate_limit_analytics

Postgres table `rate_limit_analytics`: 6 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `event_count` | `number` | no |
| `id` | `number` | no |
| `org_id` | `string` | no |
| `user_id` | `string` | no |
| `window_start` | `string` | no |

## Related tables

- [organizations](./organizations.md)
