---
type: db-table
title: "event_rsvps"
description: "Postgres table `event_rsvps`: 10 columns. References events, organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema, event]
timestamp: 2026-06-17T00:00:00Z
---

# event_rsvps

Postgres table `event_rsvps`: 10 columns. References events, organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `checked_in_at` | `string \| null` | yes |
| `checked_in_by` | `string \| null` | yes |
| `created_at` | `string \| null` | yes |
| `event_id` | `string` | no |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `status` | `string` | no |
| `track_on_lock_screen` | `boolean` | no |
| `updated_at` | `string \| null` | yes |
| `user_id` | `string` | no |

## Related tables

- [events](./events.md)
- [organizations](./organizations.md)
- [users](./users.md)
