---
type: db-table
title: "calendar_sync_preferences"
description: "Postgres table `calendar_sync_preferences`: 13 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# calendar_sync_preferences

Postgres table `calendar_sync_preferences`: 13 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string \| null` | yes |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `sync_fundraiser` | `boolean \| null` | yes |
| `sync_game` | `boolean \| null` | yes |
| `sync_general` | `boolean \| null` | yes |
| `sync_meeting` | `boolean \| null` | yes |
| `sync_philanthropy` | `boolean \| null` | yes |
| `sync_practice` | `boolean \| null` | yes |
| `sync_social` | `boolean \| null` | yes |
| `sync_workout` | `boolean \| null` | yes |
| `updated_at` | `string \| null` | yes |
| `user_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
