---
type: db-table
title: "integration_sync_log"
description: "Postgres table `integration_sync_log`: 11 columns. References org_integrations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# integration_sync_log

Postgres table `integration_sync_log`: 11 columns. References org_integrations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `completed_at` | `string \| null` | yes |
| `error_message` | `string \| null` | yes |
| `id` | `string` | no |
| `integration_id` | `string` | no |
| `records_created` | `number` | no |
| `records_skipped` | `number` | no |
| `records_unchanged` | `number` | no |
| `records_updated` | `number` | no |
| `started_at` | `string` | no |
| `status` | `string` | no |
| `sync_type` | `string` | no |

## Related tables

- [org_integrations](./org_integrations.md)
