---
name: Supabase Schema Audit & Fix
overview: Systematically audit the live Supabase schema using MCP tools, identify schema drift and RLS issues causing "adding items" failures, then fix via additive migrations. Implement working invite redemption RPCs, dynamic dropdowns, announcement notifications with Resend, and embed validation.
todos:
  - id: mcp-setup
    content: Create .cursor/mcp.json with Supabase credentials and verify connection
    status: completed
  - id: schema-audit
    content: Run MCP queries to audit live schema and document in docs/db/schema-audit.md
    status: completed
    dependencies:
      - mcp-setup
  - id: migration-core
    content: Create migration with user sync trigger and helper functions (is_org_member, is_org_admin)
    status: completed
    dependencies:
      - schema-audit
  - id: migration-invites
    content: Add create_org_invite and redeem_org_invite RPCs to migration
    status: completed
    dependencies:
      - migration-core
  - id: migration-dropdowns
    content: Add get_dropdown_options RPC to migration
    status: completed
    dependencies:
      - migration-core
  - id: apply-migration
    content: Apply migration via MCP apply_migration tool
    status: completed
    dependencies:
      - migration-invites
      - migration-dropdowns
  - id: frontend-invites
    content: Update invite pages to use RPC calls instead of client-side generation
    status: completed
    dependencies:
      - apply-migration
  - id: resend-integration
    content: Install Resend and create /api/notifications/send route
    status: completed
    dependencies:
      - apply-migration
  - id: announcement-send
    content: Wire announcement creation to call notification send API
    status: completed
    dependencies:
      - resend-integration
  - id: types-regen
    content: Regenerate TypeScript types from schema and verify build
    status: completed
    dependencies:
      - apply-migration
---

# Supabase Schema Audit and Multi-Tenant Fix Plan

## Phase 0: MCP Setup (Prerequisite)

Create `.cursor/mcp.json` with Supabase project-scoped configuration:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server@latest", "--project-ref", "YOUR_PROJECT_REF"],
      "env": {
        "SUPABASE_SERVICE_ROLE_KEY": "YOUR_SERVICE_ROLE_KEY"
      }
    }
  }
}
```

After you provide credentials and restart Cursor, I'll verify connection by calling:

- `get_project_url`
- `list_tables` for schema "public"
- `list_migrations`

---

## Phase A: Schema Audit

Use MCP `execute_sql` to extract:

1. All table columns, types, nullability, defaults
2. Foreign key relationships and ON DELETE rules
3. RLS enabled status and policy definitions
4. Triggers (especially `updated_at`)
5. Indexes on `organization_id` columns

**Focus tables**: `organizations`, `user_organization_roles`, `users`, `members`, `alumni`, `events`, `announcements`, `notifications`, `notification_preferences`, `organization_invites`, `donations`, `org_donation_embeds`, `org_philanthropy_embeds`, `philanthropy_events`

**Deliverable**: Create [`docs/db/schema-audit.md`](docs/db/schema-audit.md) documenting findings.

---

## Phase B: Core Multi-Tenant Identity Model

### Current State (from migrations):

- `has_active_role(org uuid, allowed_roles text[])` exists in [`20251211090000_rbac_tabs.sql`](supabase/migrations/20251211090000_rbac_tabs.sql)
- `user_organization_roles` has `status` column (active/revoked/pending)
- FKs reference `auth.users(id)` directly in most places

### Issues to Verify/Fix:

1. **Missing `public.users` sync trigger** - many queries join `users(name,email)` but this table may not auto-populate
2. **Add helper functions** for cleaner RLS:

   - `is_org_member(org_id uuid) returns boolean`
   - `is_org_admin(org_id uuid) returns boolean`

### Migration Plan:

```sql
-- Create/fix user sync trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name')
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, public.users.name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper functions
CREATE OR REPLACE FUNCTION is_org_member(org_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_organization_roles
    WHERE organization_id = org_id AND user_id = auth.uid() AND status = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_org_admin(org_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_organization_roles
    WHERE organization_id = org_id AND user_id = auth.uid() AND status = 'active' AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

---

## Phase C: Invite System (Generate + Redeem)

### Current Issues ([`src/app/[orgSlug]/settings/invites/page.tsx`](src/app/[orgSlug]/settings/invites/page.tsx)):

- Code/token generated **client-side** (lines 28-44) - security risk
- Redemption does direct inserts which may fail silently due to RLS
- Token lookup policy allows any non-revoked token to be read (good for joining)

### Solution - Server-side RPCs:

```sql
-- RPC: create_org_invite (admin only)
CREATE OR REPLACE FUNCTION create_org_invite(
  p_organization_id uuid,
  p_role text DEFAULT 'active_member',
  p_uses int DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
) RETURNS organization_invites AS $$
DECLARE
  v_code text;
  v_token text;
  v_result organization_invites;
BEGIN
  -- Verify caller is admin
  IF NOT is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'Only admins can create invites';
  END IF;
  
  -- Generate secure random code/token
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  v_token := encode(gen_random_bytes(24), 'base64');
  
  INSERT INTO organization_invites (organization_id, code, token, role, uses_remaining, expires_at, created_by_user_id)
  VALUES (p_organization_id, v_code, v_token, p_role, p_uses, p_expires_at, auth.uid())
  RETURNING * INTO v_result;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: redeem_org_invite (any authenticated user)
CREATE OR REPLACE FUNCTION redeem_org_invite(p_code text)
RETURNS jsonb AS $$
DECLARE
  v_invite organization_invites;
  v_org organizations;
  v_existing user_organization_roles;
BEGIN
  -- Find invite by code (case-insensitive)
  SELECT * INTO v_invite FROM organization_invites
  WHERE upper(code) = upper(p_code) AND revoked_at IS NULL;
  
  IF v_invite IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid invite code');
  END IF;
  
  -- Check expiry
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite has expired');
  END IF;
  
  -- Check uses
  IF v_invite.uses_remaining IS NOT NULL AND v_invite.uses_remaining <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite has no uses remaining');
  END IF;
  
  -- Check existing membership
  SELECT * INTO v_existing FROM user_organization_roles
  WHERE user_id = auth.uid() AND organization_id = v_invite.organization_id;
  
  IF v_existing IS NOT NULL THEN
    IF v_existing.status = 'revoked' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Your access has been revoked');
    END IF;
    -- Already a member
    SELECT * INTO v_org FROM organizations WHERE id = v_invite.organization_id;
    RETURN jsonb_build_object('success', true, 'organization_id', v_invite.organization_id, 
      'slug', v_org.slug, 'already_member', true);
  END IF;
  
  -- Insert membership with pending status (for approval flow)
  INSERT INTO user_organization_roles (user_id, organization_id, role, status)
  VALUES (auth.uid(), v_invite.organization_id, v_invite.role, 'pending');
  
  -- Decrement uses
  IF v_invite.uses_remaining IS NOT NULL THEN
    UPDATE organization_invites SET uses_remaining = uses_remaining - 1 WHERE id = v_invite.id;
  END IF;
  
  SELECT * INTO v_org FROM organizations WHERE id = v_invite.organization_id;
  RETURN jsonb_build_object('success', true, 'organization_id', v_invite.organization_id,
    'slug', v_org.slug, 'role', v_invite.role, 'pending_approval', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Frontend Updates:

- [`src/app/[orgSlug]/settings/invites/page.tsx`](src/app/[orgSlug]/settings/invites/page.tsx): Replace client-side generation with RPC call
- [`src/app/app/join/page.tsx`](src/app/app/join/page.tsx): Use `redeem_org_invite` RPC instead of direct inserts

---

## Phase D: Dynamic Dropdowns

### Current State:

- [`src/hooks/useDistinctValues.ts`](src/hooks/useDistinctValues.ts) already fetches distinct values per-org
- [`src/app/[orgSlug]/alumni/page.tsx`](src/app/[orgSlug]/alumni/page.tsx) fetches distinct values server-side (lines 65-75)

### Optimization - RPC for Batch Dropdown Options:

```sql
CREATE OR REPLACE FUNCTION get_dropdown_options(p_org_id uuid)
RETURNS jsonb AS $$
BEGIN
  IF NOT is_org_member(p_org_id) THEN
    RETURN '{}'::jsonb;
  END IF;
  
  RETURN jsonb_build_object(
    'alumni', jsonb_build_object(
      'graduation_years', (SELECT jsonb_agg(DISTINCT graduation_year ORDER BY graduation_year DESC) 
        FROM alumni WHERE organization_id = p_org_id AND deleted_at IS NULL AND graduation_year IS NOT NULL),
      'industries', (SELECT jsonb_agg(DISTINCT industry ORDER BY industry) 
        FROM alumni WHERE organization_id = p_org_id AND deleted_at IS NULL AND industry IS NOT NULL),
      'companies', (SELECT jsonb_agg(DISTINCT current_company ORDER BY current_company) 
        FROM alumni WHERE organization_id = p_org_id AND deleted_at IS NULL AND current_company IS NOT NULL),
      'cities', (SELECT jsonb_agg(DISTINCT current_city ORDER BY current_city) 
        FROM alumni WHERE organization_id = p_org_id AND deleted_at IS NULL AND current_city IS NOT NULL),
      'positions', (SELECT jsonb_agg(DISTINCT position_title ORDER BY position_title) 
        FROM alumni WHERE organization_id = p_org_id AND deleted_at IS NULL AND position_title IS NOT NULL)
    ),
    'members', jsonb_build_object(
      'roles', (SELECT jsonb_agg(DISTINCT role ORDER BY role) 
        FROM members WHERE organization_id = p_org_id AND deleted_at IS NULL AND role IS NOT NULL),
      'graduation_years', (SELECT jsonb_agg(DISTINCT graduation_year ORDER BY graduation_year DESC) 
        FROM members WHERE organization_id = p_org_id AND deleted_at IS NULL AND graduation_year IS NOT NULL)
    ),
    'events', jsonb_build_object(
      'locations', (SELECT jsonb_agg(DISTINCT location ORDER BY location) 
        FROM events WHERE organization_id = p_org_id AND deleted_at IS NULL AND location IS NOT NULL),
      'types', (SELECT jsonb_agg(DISTINCT event_type ORDER BY event_type) 
        FROM events WHERE organization_id = p_org_id AND deleted_at IS NULL)
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
```

---

## Phase E: Announcements Notification Pipeline

### Current State:

- [`src/app/[orgSlug]/announcements/new/page.tsx`](src/app/[orgSlug]/announcements/new/page.tsx) creates notification records but doesn't send
- [`src/lib/notifications.ts`](src/lib/notifications.ts) has `sendEmail` stub (lines 64-71)

### Implementation:

1. **Install Resend**: `npm install resend`

2. **Create API route** [`src/app/api/notifications/send/route.ts`](src/app/api/notifications/send/route.ts):
```typescript
import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';
import { buildNotificationTargets } from '@/lib/notifications';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  const { announcementId } = await request.json();
  const supabase = await createClient();
  
  // Load announcement
  const { data: announcement } = await supabase
    .from('announcements')
    .select('*, organizations(name)')
    .eq('id', announcementId)
    .single();
  
  if (!announcement) return Response.json({ error: 'Not found' }, { status: 404 });
  
  // Build targets
  const { targets } = await buildNotificationTargets({
    supabase,
    organizationId: announcement.organization_id,
    audience: announcement.audience === 'individuals' ? 'both' : announcement.audience,
    channel: 'email',
    targetUserIds: announcement.audience_user_ids,
  });
  
  // Send emails
  for (const target of targets) {
    if (target.email) {
      await resend.emails.send({
        from: 'noreply@yourdomain.com',
        to: target.email,
        subject: announcement.title,
        text: announcement.body || '',
      });
    }
  }
  
  // Update notification sent_at
  await supabase.from('notifications')
    .update({ sent_at: new Date().toISOString() })
    .eq('organization_id', announcement.organization_id)
    .eq('title', announcement.title);
  
  return Response.json({ sent: targets.length });
}
```

3. **Update announcement creation** to call send API after insert.

---

## Phase F: Tabs Editable + Safe Embeds

### Embeds Validation:

- Already have `CHECK (url ~ '^https://')` on embed tables
- [`src/components/shared/EmbedsViewer.tsx`](src/components/shared/EmbedsViewer.tsx) already uses `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` (line 48)

### Add Domain Whitelist (optional):

```sql
ALTER TABLE org_philanthropy_embeds 
  ADD CONSTRAINT philanthropy_embed_domain_check 
  CHECK (url ~ '^https://(www\.)?(gofundme\.com|venmo\.com|paypal\.com|givebutter\.com)');
```

### Ensure `updated_at` Triggers Exist:

- Already present for embeds tables in migrations
- Verify for all entity tables: members, alumni, events, announcements, etc.

---

## Phase G: Types Regeneration

After all migrations applied:

1. Run MCP `generate_typescript_types` 
2. Save to [`src/types/database.ts`](src/types/database.ts)
3. Run `npm run build` to verify type safety

---

## Migration File Structure

Single comprehensive migration: `supabase/migrations/20251217100000_schema_fixes.sql`

Contents:

1. User sync trigger (if missing)
2. Helper functions: `is_org_member`, `is_org_admin`
3. Invite RPCs: `create_org_invite`, `redeem_org_invite`
4. Dropdown RPC: `get_dropdown_options`
5. Missing indexes
6. RLS policy fixes

---

## Testing Checklist

After implementation:

- [ ] Admin generates invite via RPC - code returned
- [ ] Non-admin cannot call `create_org_invite`
- [ ] User redeems code via RPC - gets pending membership
- [ ] Creating member/alumni/event succeeds for admin
- [ ] Dropdowns show newly added values after page refresh
- [ ] Announcement with "individuals" audience only notifies selected users
- [ ] Donation/philanthropy embeds render with sandbox
- [ ] Edit/delete on all entity tabs works with confirmation