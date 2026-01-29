-- Dev-admin audit logging table
create table if not exists public.dev_admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id),
  admin_email_redacted text not null,
  action text not null,
  target_type text,
  target_id uuid,
  target_slug text,
  request_path text,
  request_method text,
  ip_address text,
  user_agent text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

-- Indexes for common queries
create index dev_admin_audit_logs_admin_user_idx on public.dev_admin_audit_logs(admin_user_id);
create index dev_admin_audit_logs_action_idx on public.dev_admin_audit_logs(action);
create index dev_admin_audit_logs_target_id_idx on public.dev_admin_audit_logs(target_id) where target_id is not null;
create index dev_admin_audit_logs_created_at_idx on public.dev_admin_audit_logs(created_at desc);

-- RLS: service role only (for fire-and-forget writes)
alter table public.dev_admin_audit_logs enable row level security;
create policy dev_admin_audit_logs_service_write on public.dev_admin_audit_logs
  for all using (auth.role() = 'service_role');
