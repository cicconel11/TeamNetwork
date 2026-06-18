---
type: db-table
title: "mentee_preferences"
description: "Postgres table `mentee_preferences`: 19 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, mentee]
timestamp: 2026-06-17T00:00:00Z
---

# mentee_preferences

Postgres table `mentee_preferences`: 19 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `communication_prefs` | `string[]` | no |
| `created_at` | `string` | no |
| `derived_signals` | `Json \| null` | yes |
| `derived_signals_input_hash` | `string \| null` | yes |
| `geographic_pref` | `string \| null` | yes |
| `goals` | `string \| null` | yes |
| `id` | `string` | no |
| `nice_to_have_attributes` | `string[]` | no |
| `organization_id` | `string` | no |
| `preferred_industries` | `string[]` | no |
| `preferred_positions` | `string[]` | no |
| `preferred_role_families` | `string[]` | no |
| `preferred_sports` | `string[]` | no |
| `preferred_topics` | `string[]` | no |
| `required_attributes` | `string[]` | no |
| `seeking_mentorship` | `boolean` | no |
| `time_availability` | `string \| null` | yes |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
