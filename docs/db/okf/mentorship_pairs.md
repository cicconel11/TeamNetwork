---
type: db-table
title: "mentorship_pairs"
description: "Postgres table `mentorship_pairs`: 17 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, mentorship]
timestamp: 2026-06-17T00:00:00Z
---

# mentorship_pairs

Postgres table `mentorship_pairs`: 17 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `accepted_at` | `string \| null` | yes |
| `created_at` | `string` | no |
| `declined_at` | `string \| null` | yes |
| `declined_reason` | `string \| null` | yes |
| `deleted_at` | `string \| null` | yes |
| `id` | `string` | no |
| `match_score` | `number \| null` | yes |
| `match_signals` | `Json \| null` | yes |
| `match_why` | `string \| null` | yes |
| `match_why_model` | `string \| null` | yes |
| `mentee_user_id` | `string` | no |
| `mentor_user_id` | `string` | no |
| `organization_id` | `string` | no |
| `proposed_at` | `string \| null` | yes |
| `proposed_by` | `string \| null` | yes |
| `status` | `string` | no |
| `updated_at` | `string` | no |

## Related tables

- [organizations](./organizations.md)
