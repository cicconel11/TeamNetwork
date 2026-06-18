---
type: db-table
title: "analytics_consent"
description: "Postgres table `analytics_consent`: 4 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# analytics_consent

Postgres table `analytics_consent`: 4 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `consent_state` | `Database["public"]["Enums"]["analytics_consent_state"]` | no |
| `decided_at` | `string` | no |
| `org_id` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
