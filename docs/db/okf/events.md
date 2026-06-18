---
type: db-table
title: "events"
description: "Postgres table `events`: 23 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# events

Postgres table `events`: 23 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `audience` | `string \| null` | yes |
| `check_in_mode` | `Database["public"]["Enums"]["event_check_in_mode"]` | no |
| `created_at` | `string \| null` | yes |
| `created_by_user_id` | `string \| null` | yes |
| `deleted_at` | `string \| null` | yes |
| `description` | `string \| null` | yes |
| `end_date` | `string \| null` | yes |
| `event_type` | `Database["public"]["Enums"]["event_type"] \| null` | yes |
| `geofence_enabled` | `boolean` | no |
| `geofence_radius_m` | `number` | no |
| `id` | `string` | no |
| `is_philanthropy` | `boolean \| null` | yes |
| `latitude` | `number \| null` | yes |
| `location` | `string \| null` | yes |
| `longitude` | `number \| null` | yes |
| `organization_id` | `string` | no |
| `recurrence_group_id` | `string \| null` | yes |
| `recurrence_index` | `number \| null` | yes |
| `recurrence_rule` | `Json \| null` | yes |
| `start_date` | `string` | no |
| `target_user_ids` | `string[] \| null` | yes |
| `title` | `string` | no |
| `updated_at` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
