---
type: db-table
title: "ai_audit_log"
description: "Postgres table `ai_audit_log`: 33 columns. References ai_messages, ai_threads."
resource: /apps/web/src/types/database.ts
tags: [db, schema, ai]
timestamp: 2026-06-17T00:00:00Z
---

# ai_audit_log

Postgres table `ai_audit_log`: 33 columns. References ai_messages, ai_threads.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `cache_bypass_reason` | `string \| null` | yes |
| `cache_entry_id` | `string \| null` | yes |
| `cache_status` | `string \| null` | yes |
| `context_surface` | `string \| null` | yes |
| `context_token_estimate` | `number \| null` | yes |
| `created_at` | `string` | no |
| `error` | `string \| null` | yes |
| `expires_at` | `string` | no |
| `id` | `string` | no |
| `input_tokens` | `number \| null` | yes |
| `intent` | `string \| null` | yes |
| `intent_type` | `string \| null` | yes |
| `latency_ms` | `number \| null` | yes |
| `message_id` | `string \| null` | yes |
| `model` | `string \| null` | yes |
| `org_id` | `string` | no |
| `output_tokens` | `number \| null` | yes |
| `rag_chunk_count` | `number \| null` | yes |
| `rag_error` | `string \| null` | yes |
| `rag_grounded` | `boolean \| null` | yes |
| `rag_grounding_failures` | `Json \| null` | yes |
| `rag_grounding_latency_ms` | `number \| null` | yes |
| `rag_grounding_mode` | `string \| null` | yes |
| `rag_top_similarity` | `number \| null` | yes |
| `safety_categories` | `Json \| null` | yes |
| `safety_latency_ms` | `number \| null` | yes |
| `safety_verdict` | `string \| null` | yes |
| `stage_timings` | `Json \| null` | yes |
| `thread_id` | `string \| null` | yes |
| `tool_calls` | `Json \| null` | yes |
| `user_id` | `string` | no |
| `write_action_id` | `string \| null` | yes |
| `write_action_status` | `string \| null` | yes |

## Related tables

- [ai_messages](./ai_messages.md)
- [ai_threads](./ai_threads.md)
