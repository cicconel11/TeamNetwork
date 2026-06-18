---
type: db-table
title: "breach_incidents"
description: "Postgres table `breach_incidents`: 12 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# breach_incidents

Postgres table `breach_incidents`: 12 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `affected_tables` | `string[]` | no |
| `created_at` | `string` | no |
| `description` | `string` | no |
| `discovered_at` | `string` | no |
| `district_notified_at` | `string \| null` | yes |
| `estimated_record_count` | `number \| null` | yes |
| `id` | `string` | no |
| `parents_notified_at` | `string \| null` | yes |
| `resolution_notes` | `string \| null` | yes |
| `resolved_at` | `string \| null` | yes |
| `state_notified_at` | `string \| null` | yes |
| `tier` | `number` | no |

## Related tables

_No outbound foreign keys._
