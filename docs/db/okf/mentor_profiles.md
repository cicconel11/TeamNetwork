---
type: db-table
title: "mentor_profiles"
description: "Postgres table `mentor_profiles`: 26 columns. References organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema, mentor]
timestamp: 2026-06-17T00:00:00Z
---

# mentor_profiles

Postgres table `mentor_profiles`: 26 columns. References organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `accepting_new` | `boolean` | no |
| `bio` | `string \| null` | yes |
| `bio_generated_at` | `string \| null` | yes |
| `bio_input_hash` | `string \| null` | yes |
| `bio_source` | `string \| null` | yes |
| `contact_email` | `string \| null` | yes |
| `contact_linkedin` | `string \| null` | yes |
| `contact_phone` | `string \| null` | yes |
| `created_at` | `string` | no |
| `current_mentee_count` | `number` | no |
| `custom_attributes` | `Json` | no |
| `expertise_areas` | `string[]` | no |
| `id` | `string` | no |
| `industries` | `string[]` | no |
| `is_active` | `boolean` | no |
| `max_mentees` | `number` | no |
| `meeting_preferences` | `string[]` | no |
| `organization_id` | `string` | no |
| `positions` | `string[]` | no |
| `role_families` | `string[]` | no |
| `sports` | `string[]` | no |
| `time_commitment` | `string \| null` | yes |
| `topics` | `string[]` | no |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |
| `years_of_experience` | `number \| null` | yes |

## Related tables

- [organizations](./organizations.md)
- [users](./users.md)
