---
type: db-table
title: "calendar_feeds"
description: "Postgres table `calendar_feeds`: 13 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# calendar_feeds

Postgres table `calendar_feeds`: 13 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `connected_user_id` | `string \| null` | yes |
| `created_at` | `string \| null` | yes |
| `external_calendar_id` | `string \| null` | yes |
| `feed_url` | `string` | no |
| `id` | `string` | no |
| `last_error` | `string \| null` | yes |
| `last_synced_at` | `string \| null` | yes |
| `organization_id` | `string \| null` | yes |
| `provider` | `string` | no |
| `scope` | `string` | no |
| `status` | `string` | no |
| `updated_at` | `string \| null` | yes |
| `user_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
