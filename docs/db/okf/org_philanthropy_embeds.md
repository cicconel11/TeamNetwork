---
type: db-table
title: "org_philanthropy_embeds"
description: "Postgres table `org_philanthropy_embeds`: 8 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, org]
timestamp: 2026-06-17T00:00:00Z
---

# org_philanthropy_embeds

Postgres table `org_philanthropy_embeds`: 8 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `display_order` | `number` | no |
| `embed_type` | `string` | no |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `title` | `string` | no |
| `updated_at` | `string` | no |
| `url` | `string` | no |

## Related tables

- [organizations](./organizations.md)
