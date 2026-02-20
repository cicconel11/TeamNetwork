-- Enterprise audit logging table for comprehensive admin action tracking
-- Covers all 22+ enterprise admin API routes for FERPA/COPPA compliance
create table if not exists public.enterprise_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id),
  actor_email_redacted text not null,
  action text not null,
  target_type text,
  target_id text,
  enterprise_id uuid not null,
  organization_id uuid,
  request_path text,
  request_method text,
  ip_address text,
  user_agent text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

-- Composite indexes for common query patterns
create index enterprise_audit_logs_enterprise_created_idx
  on public.enterprise_audit_logs(enterprise_id, created_at desc);

create index enterprise_audit_logs_action_created_idx
  on public.enterprise_audit_logs(action, created_at desc);

create index enterprise_audit_logs_actor_created_idx
  on public.enterprise_audit_logs(actor_user_id, created_at desc);

-- RLS: service role only (fire-and-forget writes from API routes)
alter table public.enterprise_audit_logs enable row level security;

create policy enterprise_audit_logs_service_only
  on public.enterprise_audit_logs
  for all using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
