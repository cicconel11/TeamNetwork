---
type: db-table
title: "ui_profiles"
description: "Postgres table `ui_profiles`: 8 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# ui_profiles

Postgres table `ui_profiles`: 8 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `expires_at` | `string` | no |
| `generated_at` | `string` | no |
| `id` | `string` | no |
| `llm_provider` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `profile` | `Json` | no |
| `summary_hash` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [organizations](./organizations.md)
