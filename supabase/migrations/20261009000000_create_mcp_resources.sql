-- MCP resources table: stores skills/knowledge exposed via MCP protocol
BEGIN;

CREATE TABLE public.mcp_resources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uri         text NOT NULL UNIQUE,
  title       text NOT NULL,
  description text NOT NULL,
  mime_type   text NOT NULL DEFAULT 'text/markdown',
  category    text NOT NULL,
  body        text NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_resources ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; allow anon/authenticated read for PostgREST access
CREATE POLICY "mcp_resources_read" ON public.mcp_resources
  FOR SELECT USING (true);

-- Seed: organization-tenancy skill
INSERT INTO public.mcp_resources (uri, title, description, category, body) VALUES (
  'skill://teamnetwork/organization-tenancy',
  'Organization Tenancy',
  'Multi-tenant routing, middleware validation, and role-based access patterns',
  'skill',
  E'## Organization Tenancy\n\n'
  E'Routes are scoped by `[orgSlug]`. Middleware (`src/middleware.ts`) validates every request:\n'
  E'1. Parse auth cookies + validate JWT\n'
  E'2. Check `user_organization_roles` for membership in the target org\n'
  E'3. Redirect revoked users to `/app` with error\n\n'
  E'**Roles**: `admin` (full), `active_member` (most features), `alumni` (read-only), `parent` (selected, requires org flag).\n'
  E'Normalize on insert: `member` -> `active_member`, `viewer` -> `alumni`.\n\n'
  E'**Queries**: Always filter `.is("deleted_at", null)` (soft-delete convention).\n'
  E'**Auth helpers**: `getOrgContext()` and `isOrgAdmin()` in `src/lib/auth/roles.ts`.\n'
  E'**Org existence**: Finalized in `src/app/[orgSlug]/layout.tsx`, not middleware.'
);

-- Seed: stripe-entitlements skill
INSERT INTO public.mcp_resources (uri, title, description, category, body) VALUES (
  'skill://teamnetwork/stripe-entitlements',
  'Stripe Entitlements',
  'Payment idempotency, webhook dedup, and Stripe Connect donation flow',
  'skill',
  E'## Stripe Entitlements\n\n'
  E'**Idempotency**: Client generates stable `idempotency_key` (localStorage).\n'
  E'Server creates `payment_attempts` row (unique constraint) -> duplicates return existing checkout URL.\n'
  E'States: `initiated` -> `processing` -> `succeeded` | `failed`.\n\n'
  E'**Webhook dedup**: Events stored in `stripe_events(event_id unique)`. Skip if already processed.\n'
  E'Files: `src/lib/payments/idempotency.ts`, `src/lib/payments/stripe-events.ts`.\n\n'
  E'**Stripe Connect (donations)**: Funds route directly to org''s connected account, never touching the platform.\n'
  E'See `docs/stripe-donations.md` for full flow.\n\n'
  E'**Env**: `SKIP_STRIPE_VALIDATION=true` skips price ID validation in dev.'
);

COMMIT;
