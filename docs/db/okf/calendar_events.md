---
type: db-table
title: "calendar_events"
description: "Postgres table `calendar_events`: 16 columns. References calendar_feeds, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# calendar_events

Postgres table `calendar_events`: 16 columns. References calendar_feeds, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `all_day` | `boolean \| null` | yes |
| `created_at` | `string \| null` | yes |
| `description` | `string \| null` | yes |
| `end_at` | `string \| null` | yes |
| `external_uid` | `string` | no |
| `feed_id` | `string` | no |
| `id` | `string` | no |
| `instance_key` | `string` | no |
| `location` | `string \| null` | yes |
| `organization_id` | `string \| null` | yes |
| `raw` | `Json \| null` | yes |
| `scope` | `string` | no |
| `start_at` | `string` | no |
| `title` | `string \| null` | yes |
| `updated_at` | `string \| null` | yes |
| `user_id` | `string` | no |

## Related tables

- [calendar_feeds](./calendar_feeds.md)
- [organizations](./organizations.md)
