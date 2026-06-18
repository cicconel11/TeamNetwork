---
type: db-table
title: "ai_semantic_cache"
description: "Postgres table `ai_semantic_cache`: 13 columns. References ai_messages, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, ai]
timestamp: 2026-06-17T00:00:00Z
---

# ai_semantic_cache

Postgres table `ai_semantic_cache`: 13 columns. References ai_messages, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `cache_version` | `number` | no |
| `created_at` | `string` | no |
| `expires_at` | `string` | no |
| `id` | `string` | no |
| `invalidated_at` | `string \| null` | yes |
| `invalidation_reason` | `string \| null` | yes |
| `org_id` | `string` | no |
| `permission_scope_key` | `string` | no |
| `prompt_hash` | `string` | no |
| `prompt_normalized` | `string` | no |
| `response_content` | `string` | no |
| `source_message_id` | `string \| null` | yes |
| `surface` | `string` | no |

## Related tables

- [ai_messages](./ai_messages.md)
- [organizations](./organizations.md)
