---
type: db-table
title: "payment_attempts"
description: "Postgres table `payment_attempts`: 20 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# payment_attempts

Postgres table `payment_attempts`: 20 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `amount_cents` | `number` | no |
| `checkout_url` | `string \| null` | yes |
| `created_at` | `string` | no |
| `currency` | `string` | no |
| `flow_type` | `string` | no |
| `id` | `string` | no |
| `idempotency_key` | `string` | no |
| `is_trial` | `boolean` | no |
| `last_error` | `string \| null` | yes |
| `metadata` | `Json \| null` | yes |
| `organization_id` | `string \| null` | yes |
| `request_fingerprint` | `string \| null` | yes |
| `status` | `string` | no |
| `stripe_checkout_session_id` | `string \| null` | yes |
| `stripe_connected_account_id` | `string \| null` | yes |
| `stripe_payment_intent_id` | `string \| null` | yes |
| `stripe_payout_id` | `string \| null` | yes |
| `stripe_transfer_id` | `string \| null` | yes |
| `updated_at` | `string` | no |
| `user_id` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
