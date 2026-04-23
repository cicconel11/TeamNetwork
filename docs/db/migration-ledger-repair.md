# Migration Ledger Repair

Use this when Supabase migration history and remote schema have drifted.

## Rule

Do not repair the ledger for a migration unless the remote database state for that exact migration has been verified directly.

`supabase migration repair --status applied <version>` is only safe when the migration is already fully present remotely.

`supabase migration repair --status reverted <version>` is only safe when the migration is fully absent remotely and you intend to re-run it with `supabase db push`.

If a migration both changes schema and backfills or installs triggers/functions, treat it as operator-only until inspected manually.

## Current Classification

Safe to mark `applied` only after remote verification:

- `20261022000000_ai_audit_safety_columns.sql`
- `20261022100000_ai_audit_rag_grounding_columns.sql`
- `20261023000000_add_org_captcha_provider.sql`

Operator judgment required before any ledger write:

- `20261019000000_mentorship_native_tables.sql`
- `20261020100000_donation_stats_sync_trigger.sql`
- `20261020200001_batch_create_enterprise_orgs.sql`
- `20261020200002_enterprise_counts_function.sql`

## Remote Verification Workflow

1. Diff local migrations against the linked remote:

```bash
npx supabase db diff --linked --schema public
```

2. For each disputed migration, inspect the actual remote objects:

- Tables and columns for additive migrations
- Trigger/function presence for behavioral migrations
- Backfilled row shape for data migrations

3. Resolve per migration:

- Fully applied: `supabase migration repair --status applied <version>`
- Fully unapplied: `supabase migration repair --status reverted <version>` then `supabase db push`
- Partially applied: remediate remote schema/data first, then repair the ledger

## Why This Exists

This repo already has application code that depends on `mentee_preferences`, AI audit columns, and `captcha_provider`, while other migrations in the same area change triggers and functions. A blind ledger repair can permanently hide a missing table or skip a trigger installation that production behavior depends on.
