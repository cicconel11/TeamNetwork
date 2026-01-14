import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function squishWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

function findLatestMigrationContaining(pattern: RegExp): string {
  const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
  const matches = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => pattern.test(fs.readFileSync(path.join(migrationsDir, name), "utf8")))
    .sort();

  assert.ok(matches.length > 0, `expected to find a migration matching ${pattern}`);
  return path.join("supabase", "migrations", matches[matches.length - 1]);
}

test("latest alumni quota SQL recognizes current alumni bucket values", () => {
  const migrationPath = findLatestMigrationContaining(
    /CREATE OR REPLACE FUNCTION public\.alumni_bucket_limit\(p_bucket text\)/,
  );
  const source = readSource(migrationPath);
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes("WHEN p_bucket = '0-250' THEN 250"),
    "latest alumni bucket SQL must recognize the 0-250 tier",
  );
  assert.ok(
    normalized.includes("WHEN p_bucket = '251-500' THEN 500"),
    "latest alumni bucket SQL must recognize the 251-500 tier",
  );
  assert.ok(
    normalized.includes("WHEN p_bucket = '501-1000' THEN 1000"),
    "latest alumni bucket SQL must recognize the 501-1000 tier",
  );
  assert.ok(
    normalized.includes("WHEN p_bucket = '1001-2500' THEN 2500"),
    "latest alumni bucket SQL must recognize the 1001-2500 tier",
  );
  assert.ok(
    normalized.includes("WHEN p_bucket = '2500-5000' THEN 5000"),
    "latest alumni bucket SQL must recognize the 2500-5000 tier",
  );
  assert.ok(
    normalized.includes("WHEN p_bucket = '5000+' THEN NULL"),
    "latest alumni bucket SQL must recognize the unlimited tier",
  );
  assert.ok(
    normalized.includes("WHEN p_bucket = '0-200' THEN 200"),
    "latest alumni bucket SQL must preserve the 0-200 legacy alias",
  );
  assert.ok(
    normalized.includes("WHEN p_bucket = '201-600' THEN 600"),
    "latest alumni bucket SQL must preserve the 201-600 legacy alias",
  );
  assert.ok(
    normalized.includes("WHEN p_bucket = '601-1500' THEN 1500"),
    "latest alumni bucket SQL must preserve the 601-1500 legacy alias",
  );
  assert.ok(
    normalized.includes("WHEN p_bucket = '1500+' THEN NULL"),
    "latest alumni bucket SQL must preserve the 1500+ legacy alias",
  );
});

test("settings invites page does not create org invites through direct client RPC", () => {
  const pageSource = readSource("src/app/[orgSlug]/settings/invites/page.tsx");
  const pageNormalized = squishWhitespace(pageSource);
  const panelSource = readSource("src/components/settings/OrgInvitePanel.tsx");
  const panelNormalized = squishWhitespace(panelSource);

  assert.strictEqual(
    pageSource.includes('supabase.rpc("create_org_invite"'),
    false,
    "settings page must not call create_org_invite directly from the browser",
  );
  assert.ok(
    pageNormalized.includes("<OrgInvitePanel"),
    "settings page must delegate invite creation UI to OrgInvitePanel",
  );
  assert.ok(
    panelNormalized.includes('fetch(`/api/organizations/${orgId}/invites`, {'),
    "org invite UI must create org invites through the server route",
  );
});

test("org invites API route authorizes admins through service client", () => {
  const source = readSource("src/app/api/organizations/[organizationId]/invites/route.ts");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes("await serviceSupabase .from(\"user_organization_roles\")"),
    "org invites route must check role via service client, not SSR client",
  );
  assert.ok(
    normalized.includes('return respond({ error: "Unable to verify permissions" }, 500);'),
    "org invites route must fail closed when role lookup errors",
  );
});

test("org invites API route creates invites through authenticated server RPC", () => {
  const source = readSource("src/app/api/organizations/[organizationId]/invites/route.ts");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes('role: z.enum(["admin", "active_member", "alumni"])'),
    "org invites route must validate allowed invite roles",
  );
  assert.ok(
    normalized.includes('const { data: invite, error: rpcError } = await (supabase as any).rpc("create_org_invite", {'),
    "org invites route must call create_org_invite through the authenticated Supabase client",
  );
  assert.strictEqual(
    normalized.includes('(serviceSupabase as any).rpc("create_org_invite"'),
    false,
    "org invites route must not call create_org_invite through the service client",
  );
  assert.ok(
    normalized.includes("p_organization_id: organizationId"),
    "org invites route must scope invite creation to the requested organization",
  );
  assert.ok(
    normalized.includes("p_role: body.role"),
    "org invites route must forward the requested invite role to the RPC",
  );
  assert.ok(
    normalized.includes("p_uses: body.uses ?? null"),
    "org invites route must forward optional use limits to the RPC",
  );
  assert.ok(
    normalized.includes("p_expires_at: body.expiresAt ?? null"),
    "org invites route must forward optional expiration to the RPC",
  );
  assert.ok(
    normalized.includes('revalidatePath(`/${orgSlugRow.slug}/settings/invites`)'),
    "org invites route must revalidate the invites settings page after invite creation",
  );
});
