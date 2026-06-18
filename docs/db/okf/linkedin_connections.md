---
type: db-table
title: "linkedin_connections"
description: "Postgres table `linkedin_connections`: 12 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema, linkedin]
timestamp: 2026-06-17T00:00:00Z
---

# linkedin_connections

Postgres table `linkedin_connections`: 12 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `connected_at` | `string` | no |
| `created_at` | `string` | no |
| `disconnected_at` | `string \| null` | yes |
| `id` | `string` | no |
| `linkedin_email` | `string \| null` | yes |
| `linkedin_family_name` | `string \| null` | yes |
| `linkedin_given_name` | `string \| null` | yes |
| `linkedin_name` | `string \| null` | yes |
| `linkedin_picture_url` | `string \| null` | yes |
| `linkedin_sub` | `string` | no |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |

## Related tables

_No outbound foreign keys._
