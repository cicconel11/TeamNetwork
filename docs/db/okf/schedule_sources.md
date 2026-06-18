---
type: db-table
title: "schedule_sources"
description: "Postgres table `schedule_sources`: 17 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# schedule_sources

Postgres table `schedule_sources`: 17 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `connected_user_id` | `string \| null` | yes |
| `created_at` | `string \| null` | yes |
| `created_by` | `string \| null` | yes |
| `external_calendar_id` | `string \| null` | yes |
| `id` | `string` | no |
| `last_cancelled` | `number \| null` | yes |
| `last_error` | `string \| null` | yes |
| `last_event_count` | `number \| null` | yes |
| `last_imported` | `number \| null` | yes |
| `last_synced_at` | `string \| null` | yes |
| `last_updated` | `number \| null` | yes |
| `org_id` | `string` | no |
| `source_url` | `string` | no |
| `status` | `string` | no |
| `title` | `string \| null` | yes |
| `updated_at` | `string \| null` | yes |
| `vendor_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
