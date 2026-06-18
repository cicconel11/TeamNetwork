---
type: db-table
title: "error_groups"
description: "Postgres table `error_groups`: 16 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# error_groups

Postgres table `error_groups`: 16 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `baseline_rate_1h` | `number \| null` | yes |
| `count_1h` | `number` | no |
| `count_24h` | `number` | no |
| `env` | `string` | no |
| `fingerprint` | `string` | no |
| `first_notified_at` | `string \| null` | yes |
| `first_seen_at` | `string` | no |
| `id` | `string` | no |
| `last_notified_at` | `string \| null` | yes |
| `last_seen_at` | `string` | no |
| `sample_event` | `Json` | no |
| `severity` | `string` | no |
| `spike_threshold_1h` | `number \| null` | yes |
| `status` | `string` | no |
| `title` | `string` | no |
| `total_count` | `number` | no |

## Related tables

_No outbound foreign keys._
