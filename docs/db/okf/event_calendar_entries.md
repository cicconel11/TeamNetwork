---
type: db-table
title: "event_calendar_entries"
description: "Postgres table `event_calendar_entries`: 11 columns. References events, organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema, event]
timestamp: 2026-06-17T00:00:00Z
---

# event_calendar_entries

Postgres table `event_calendar_entries`: 11 columns. References events, organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string \| null` | yes |
| `event_id` | `string` | no |
| `external_calendar_id` | `string` | no |
| `external_event_id` | `string` | no |
| `id` | `string` | no |
| `last_error` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `provider` | `string` | no |
| `sync_status` | `string` | no |
| `updated_at` | `string \| null` | yes |
| `user_id` | `string` | no |

## Related tables

- [events](./events.md)
- [organizations](./organizations.md)
- [users](./users.md)
