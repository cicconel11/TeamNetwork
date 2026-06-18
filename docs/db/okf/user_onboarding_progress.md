---
type: db-table
title: "user_onboarding_progress"
description: "Postgres table `user_onboarding_progress`: 10 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, user]
timestamp: 2026-06-17T00:00:00Z
---

# user_onboarding_progress

Postgres table `user_onboarding_progress`: 10 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `completed_items` | `Json` | no |
| `created_at` | `string` | no |
| `dismissed_at` | `string \| null` | yes |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `tour_completed_at` | `string \| null` | yes |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |
| `visited_items` | `Json` | no |
| `welcome_seen_at` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
