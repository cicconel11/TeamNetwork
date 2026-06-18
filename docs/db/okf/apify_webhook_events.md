---
type: db-table
title: "apify_webhook_events"
description: "Postgres table `apify_webhook_events`: 4 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# apify_webhook_events

Postgres table `apify_webhook_events`: 4 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `event_type` | `string \| null` | yes |
| `id` | `string` | no |
| `received_at` | `string` | no |
| `run_id` | `string \| null` | yes |

## Related tables

_No outbound foreign keys._
