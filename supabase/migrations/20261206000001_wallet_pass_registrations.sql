-- Tracks devices registered for Apple Wallet pass updates per the PassKit
-- web service spec. Populated by the /api/wallet/v1/devices/... endpoints
-- (added in Phase 4). Storing now so Phase 4 can ship without a separate
-- migration window.
create table if not exists public.wallet_pass_registrations (
  id uuid primary key default gen_random_uuid(),
  pass_type_identifier text not null,
  serial_number text not null,
  device_library_identifier text not null,
  push_token text not null,
  authentication_token text not null,
  created_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  unique (pass_type_identifier, serial_number, device_library_identifier)
);

create index if not exists wallet_pass_registrations_pass_idx
  on public.wallet_pass_registrations (pass_type_identifier, serial_number);

create index if not exists wallet_pass_registrations_device_idx
  on public.wallet_pass_registrations (device_library_identifier);

comment on table public.wallet_pass_registrations is
  'Apple Wallet pass registrations per the PassKit web service spec. Populated when a device installs a pass with a webServiceURL.';

alter table public.wallet_pass_registrations enable row level security;

-- No public policies. All access goes through the service role from the
-- Next.js webservice endpoints (signed PassKit auth tokens are validated
-- in application code, not RLS).
