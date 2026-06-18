---
type: db-table
title: "enterprises"
description: "Postgres table `enterprises`: 11 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# enterprises

Postgres table `enterprises`: 11 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `billing_contact_email` | `string \| null` | yes |
| `created_at` | `string` | no |
| `description` | `string \| null` | yes |
| `id` | `string` | no |
| `logo_url` | `string \| null` | yes |
| `name` | `string` | no |
| `nav_config` | `Json \| null` | yes |
| `nav_locked_items` | `string[] \| null` | yes |
| `primary_color` | `string \| null` | yes |
| `slug` | `string` | no |
| `updated_at` | `string` | no |

## Related tables

_No outbound foreign keys._
