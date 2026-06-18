---
type: db-table
title: "organization_donation_stats"
description: "Postgres table `organization_donation_stats`: 5 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, organization]
timestamp: 2026-06-17T00:00:00Z
---

# organization_donation_stats

Postgres table `organization_donation_stats`: 5 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `donation_count` | `number` | no |
| `last_donation_at` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `total_amount_cents` | `number` | no |
| `updated_at` | `string` | no |

## Related tables

- [organizations](./organizations.md)
