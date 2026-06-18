---
type: db-table
title: "competition_points"
description: "Postgres table `competition_points`: 12 columns. References competition_teams, competitions, members, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# competition_points

Postgres table `competition_points`: 12 columns. References competition_teams, competitions, members, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `competition_id` | `string` | no |
| `created_at` | `string \| null` | yes |
| `created_by` | `string \| null` | yes |
| `deleted_at` | `string \| null` | yes |
| `id` | `string` | no |
| `member_id` | `string \| null` | yes |
| `notes` | `string \| null` | yes |
| `organization_id` | `string \| null` | yes |
| `points` | `number` | no |
| `reason` | `string \| null` | yes |
| `team_id` | `string \| null` | yes |
| `team_name` | `string \| null` | yes |

## Related tables

- [competition_teams](./competition_teams.md)
- [competitions](./competitions.md)
- [members](./members.md)
- [organizations](./organizations.md)
