import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL(
    "../supabase/migrations/20261219000000_organization_email_domains.sql",
    import.meta.url
  ),
  "utf8"
);

test("creates organization_email_domains with one-domain-per-org semantics", () => {
  assert.match(sql, /create table if not exists public\.organization_email_domains/i);
  assert.match(sql, /organization_id uuid not null unique references public\.organizations\(id\) on delete cascade/i);
  assert.match(sql, /resend_domain_id text/i);
  assert.match(sql, /dns_records jsonb not null default '\[\]'::jsonb/i);
});

test("status CHECK mirrors the Resend SDK DomainStatus union", () => {
  assert.match(
    sql,
    /status in \('not_started', 'pending', 'verified', 'failed', 'partially_verified', 'partially_failed'\)/i
  );
});

test("enforces global case-insensitive domain uniqueness", () => {
  assert.match(
    sql,
    /create unique index if not exists organization_email_domains_domain_key\s+on public\.organization_email_domains \(lower\(domain\)\)/i
  );
});

test("sender local part is constrained to a safe POSIX pattern", () => {
  assert.match(sql, /sender_local_part text not null default 'noreply'/i);
  assert.match(sql, /sender_local_part ~ '\^\[a-z0-9\]\(\[a-z0-9\._-\]\*\[a-z0-9\]\)\?\$'/i);
  assert.match(sql, /length\(sender_local_part\) <= 64/i);
  // Postgres ~ is POSIX: non-capturing groups would silently misparse.
  assert.doesNotMatch(sql, /\(\?:/);
});

test("table is locked to service_role via RLS", () => {
  assert.match(sql, /alter table public\.organization_email_domains enable row level security/i);
  assert.match(sql, /drop policy if exists organization_email_domains_service_only/i);
  assert.match(
    sql,
    /for all using \(auth\.role\(\) = 'service_role'\)\s+with check \(auth\.role\(\) = 'service_role'\)/i
  );
});

test("migration is transactional", () => {
  assert.match(sql, /^begin;/im);
  assert.match(sql, /commit;\s*$/i);
});
