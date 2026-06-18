---
type: db-table
title: "mentorship_meetings"
description: "Postgres table `mentorship_meetings`: 15 columns. References mentorship_pairs, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, mentorship]
timestamp: 2026-06-17T00:00:00Z
---

# mentorship_meetings

Postgres table `mentorship_meetings`: 15 columns. References mentorship_pairs, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `calendar_event_id` | `string \| null` | yes |
| `calendar_sync_status` | `string` | no |
| `created_at` | `string` | no |
| `created_by` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `duration_minutes` | `number` | no |
| `id` | `string` | no |
| `meeting_link` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `pair_id` | `string` | no |
| `platform` | `string` | no |
| `scheduled_at` | `string` | no |
| `scheduled_end_at` | `string \| null` | yes |
| `title` | `string` | no |
| `updated_at` | `string` | no |

## Related tables

- [mentorship_pairs](./mentorship_pairs.md)
- [organizations](./organizations.md)
