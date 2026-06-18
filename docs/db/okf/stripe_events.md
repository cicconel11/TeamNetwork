---
type: db-table
title: "stripe_events"
description: "Postgres table `stripe_events`: 7 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema, stripe]
timestamp: 2026-06-17T00:00:00Z
---

# stripe_events

Postgres table `stripe_events`: 7 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `event_id` | `string` | no |
| `id` | `string` | no |
| `leased_at` | `string \| null` | yes |
| `payload_json` | `Json \| null` | yes |
| `processed_at` | `string \| null` | yes |
| `type` | `string` | no |

## Related tables

_No outbound foreign keys._
