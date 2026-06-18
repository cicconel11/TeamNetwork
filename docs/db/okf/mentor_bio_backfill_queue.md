---
type: db-table
title: "mentor_bio_backfill_queue"
description: "Postgres table `mentor_bio_backfill_queue`: 8 columns. References mentor_profiles, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, mentor]
timestamp: 2026-06-17T00:00:00Z
---

# mentor_bio_backfill_queue

Postgres table `mentor_bio_backfill_queue`: 8 columns. References mentor_profiles, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `attempts` | `number` | no |
| `created_at` | `string` | no |
| `error` | `string \| null` | yes |
| `id` | `string` | no |
| `mentor_profile_id` | `string` | no |
| `organization_id` | `string` | no |
| `processed_at` | `string \| null` | yes |
| `updated_at` | `string` | no |

## Related tables

- [mentor_profiles](./mentor_profiles.md)
- [organizations](./organizations.md)
