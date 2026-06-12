import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { emailDomainCreateSchema } from "@/lib/schemas/email-domain";
import {
  createDomain,
  domainApiError,
  removeDomain,
  verifyDomain,
} from "@/lib/notifications/email-domains";

/**
 * Simulation tests for /api/organizations/[orgId]/email-domain (+ /verify).
 *
 * Auth/role gating mirrors the route; domain validation, Resend stub-mode
 * behavior, and table I/O run through the REAL schema, wrapper, and stub.
 * RESEND_API_KEY is unset under the test runner, so the wrapper's stub mode
 * is exercised exactly as in local dev.
 */

type Stub = ReturnType<typeof createSupabaseStub>;

interface SimResult {
  status: number;
  error?: string;
  emailDomain?: {
    domain: string;
    status: string;
    dnsRecords: unknown[];
    senderLocalPart: string;
    senderDisplayName: string | null;
  };
}

function adminGate(auth: AuthContext, organizationId: string | undefined): SimResult | null {
  if (!isAuthenticated(auth)) return { status: 401, error: "Unauthorized" };
  if (!organizationId) return { status: 400, error: "Invalid organization id" };
  if (!isOrgAdmin(auth, organizationId)) return { status: 403, error: "Forbidden" };
  return null;
}

function serialize(row: Record<string, unknown>): SimResult["emailDomain"] {
  return {
    domain: row.domain as string,
    status: row.status as string,
    dnsRecords: (row.dns_records as unknown[]) ?? [],
    senderLocalPart: row.sender_local_part as string,
    senderDisplayName: (row.sender_display_name as string | null) ?? null,
  };
}

async function simulateCreate(
  request: { auth: AuthContext; organizationId?: string; body: unknown },
  stub: Stub,
  opts?: { isReadOnly?: boolean }
): Promise<SimResult> {
  const gate = adminGate(request.auth, request.organizationId);
  if (gate) return gate;
  if (opts?.isReadOnly) return { status: 403, error: "Organization is in read-only mode" };

  const parsed = emailDomainCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    return { status: 400, error: parsed.error.issues[0]?.message ?? "Invalid request body" };
  }
  const input = parsed.data;
  const organizationId = request.organizationId as string;

  const { data: existing } = stub
    .from("organization_email_domains")
    .select("id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (existing) {
    return { status: 409, error: "This organization already has an email domain. Remove it before adding another." };
  }

  const { data: claimed } = stub
    .from("organization_email_domains")
    .select("id")
    .eq("domain", input.domain)
    .maybeSingle();
  if (claimed) {
    return { status: 409, error: "This domain is already claimed by another organization." };
  }

  const snapshot = await createDomain(input.domain);
  const { data: inserted, error: insertError } = stub
    .from("organization_email_domains")
    .insert({
      organization_id: organizationId,
      domain: input.domain,
      resend_domain_id: snapshot.id,
      status: snapshot.status,
      dns_records: snapshot.records,
      sender_local_part: input.senderLocalPart ?? "noreply",
      sender_display_name: input.senderDisplayName || null,
    })
    .single();

  if (insertError || !inserted) {
    await removeDomain(snapshot.id).catch(() => undefined);
    if (insertError?.code === "23505") {
      return { status: 409, error: "This domain is already claimed by another organization." };
    }
    return { status: 500, error: insertError?.message ?? "Failed to save domain" };
  }

  return { status: 201, emailDomain: serialize(inserted) };
}

async function simulateVerify(
  request: { auth: AuthContext; organizationId?: string },
  stub: Stub
): Promise<SimResult> {
  const gate = adminGate(request.auth, request.organizationId);
  if (gate) return gate;
  const organizationId = request.organizationId as string;

  const { data } = stub
    .from("organization_email_domains")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return { status: 404, error: "No email domain configured for this organization." };
  if (!data.resend_domain_id) {
    return { status: 409, error: "Domain is not registered with the email service." };
  }

  const snapshot = await verifyDomain(data.resend_domain_id as string, data.domain as string);
  const { data: updated } = stub
    .from("organization_email_domains")
    .update({ status: snapshot.status, dns_records: snapshot.records })
    .eq("id", data.id as string)
    .maybeSingle();

  return { status: 200, emailDomain: serialize(updated ?? data) };
}

async function simulateDelete(
  request: { auth: AuthContext; organizationId?: string },
  stub: Stub
): Promise<SimResult> {
  const gate = adminGate(request.auth, request.organizationId);
  if (gate) return gate;
  const organizationId = request.organizationId as string;

  const { data } = stub
    .from("organization_email_domains")
    .select("id, resend_domain_id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return { status: 404, error: "No email domain configured for this organization." };

  if (data.resend_domain_id) {
    await removeDomain(data.resend_domain_id as string);
  }
  await stub.from("organization_email_domains").delete().eq("id", data.id as string);
  return { status: 200 };
}

const ORG = "org-1";

test("email domain create requires authentication", async () => {
  const stub = createSupabaseStub();
  const result = await simulateCreate(
    { auth: AuthPresets.unauthenticated, organizationId: ORG, body: { domain: "villanova.edu" } },
    stub
  );
  assert.strictEqual(result.status, 401);
});

test("email domain create requires admin role", async () => {
  const stub = createSupabaseStub();
  const result = await simulateCreate(
    { auth: AuthPresets.orgMember(ORG), organizationId: ORG, body: { domain: "villanova.edu" } },
    stub
  );
  assert.strictEqual(result.status, 403);
});

test("email domain create blocks read-only mode", async () => {
  const stub = createSupabaseStub();
  const result = await simulateCreate(
    { auth: AuthPresets.orgAdmin(ORG), organizationId: ORG, body: { domain: "villanova.edu" } },
    stub,
    { isReadOnly: true }
  );
  assert.strictEqual(result.status, 403);
});

test("email domain create rejects public mailbox providers", async () => {
  const stub = createSupabaseStub();
  const result = await simulateCreate(
    { auth: AuthPresets.orgAdmin(ORG), organizationId: ORG, body: { domain: "gmail.com" } },
    stub
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("domain your organization owns"));
});

test("email domain create rejects malformed hostnames", async () => {
  const stub = createSupabaseStub();
  for (const domain of ["not a domain", "nodot", "-bad.edu", "spoof@evil.com"]) {
    const result = await simulateCreate(
      { auth: AuthPresets.orgAdmin(ORG), organizationId: ORG, body: { domain } },
      stub
    );
    assert.strictEqual(result.status, 400, `expected 400 for "${domain}"`);
  }
});

test("email domain create succeeds in stub mode with pending DNS records", async () => {
  const stub = createSupabaseStub();
  const result = await simulateCreate(
    {
      auth: AuthPresets.orgAdmin(ORG),
      organizationId: ORG,
      body: { domain: "Villanova.EDU", senderDisplayName: "Villanova Football" },
    },
    stub
  );
  assert.strictEqual(result.status, 201);
  assert.strictEqual(result.emailDomain?.domain, "villanova.edu"); // lowercased by schema
  assert.strictEqual(result.emailDomain?.status, "pending");
  assert.strictEqual(result.emailDomain?.senderLocalPart, "noreply");
  assert.strictEqual(result.emailDomain?.senderDisplayName, "Villanova Football");
  const records = result.emailDomain?.dnsRecords as { record: string }[];
  assert.ok(records.length >= 2);
  assert.ok(records.some((r) => r.record === "DKIM"));
  assert.ok(records.some((r) => r.record === "SPF"));
});

test("an org cannot register a second domain", async () => {
  const stub = createSupabaseStub();
  stub.seed("organization_email_domains", [
    { organization_id: ORG, domain: "first.edu", status: "pending", sender_local_part: "noreply" },
  ]);
  const result = await simulateCreate(
    { auth: AuthPresets.orgAdmin(ORG), organizationId: ORG, body: { domain: "second.edu" } },
    stub
  );
  assert.strictEqual(result.status, 409);
});

test("a domain claimed by another org returns 409", async () => {
  const stub = createSupabaseStub();
  stub.seed("organization_email_domains", [
    { organization_id: "org-other", domain: "villanova.edu", status: "verified", sender_local_part: "noreply" },
  ]);
  const result = await simulateCreate(
    { auth: AuthPresets.orgAdmin(ORG), organizationId: ORG, body: { domain: "villanova.edu" } },
    stub
  );
  assert.strictEqual(result.status, 409);
  assert.ok(result.error?.includes("already claimed"));
});

test("verify flips a stub domain to verified", async () => {
  const stub = createSupabaseStub();
  const created = await simulateCreate(
    { auth: AuthPresets.orgAdmin(ORG), organizationId: ORG, body: { domain: "verifyme.edu" } },
    stub
  );
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.emailDomain?.status, "pending");

  const verified = await simulateVerify({ auth: AuthPresets.orgAdmin(ORG), organizationId: ORG }, stub);
  assert.strictEqual(verified.status, 200);
  assert.strictEqual(verified.emailDomain?.status, "verified");
  const records = verified.emailDomain?.dnsRecords as { status: string }[];
  assert.ok(records.every((r) => r.status === "verified"));
});

test("verify returns 404 when no domain is configured", async () => {
  const stub = createSupabaseStub();
  const result = await simulateVerify({ auth: AuthPresets.orgAdmin(ORG), organizationId: ORG }, stub);
  assert.strictEqual(result.status, 404);
});

test("delete removes the row and frees the domain for re-registration", async () => {
  const stub = createSupabaseStub();
  await simulateCreate(
    { auth: AuthPresets.orgAdmin(ORG), organizationId: ORG, body: { domain: "recycle.edu" } },
    stub
  );
  const deleted = await simulateDelete({ auth: AuthPresets.orgAdmin(ORG), organizationId: ORG }, stub);
  assert.strictEqual(deleted.status, 200);
  assert.strictEqual(stub.getRows("organization_email_domains").length, 0);

  const recreated = await simulateCreate(
    { auth: AuthPresets.orgAdmin("org-2"), organizationId: "org-2", body: { domain: "recycle.edu" } },
    stub
  );
  assert.strictEqual(recreated.status, 201);
});

test("sending-only Resend keys map to an actionable permission error", () => {
  const restricted = domainApiError("This API key is restricted to only send emails", "fallback");
  assert.ok(restricted.message.includes("RESEND_DOMAINS_API_KEY"));
  assert.ok(restricted.message.includes("Full access"));

  // Other Resend errors pass through untouched.
  const other = domainApiError("Domain quota exceeded", "fallback");
  assert.strictEqual(other.message, "Domain quota exceeded");
  const empty = domainApiError(undefined, "fallback");
  assert.strictEqual(empty.message, "fallback");
});

test("delete requires admin and an existing row", async () => {
  const stub = createSupabaseStub();
  const nonAdmin = await simulateDelete({ auth: AuthPresets.orgMember(ORG), organizationId: ORG }, stub);
  assert.strictEqual(nonAdmin.status, 403);
  const missing = await simulateDelete({ auth: AuthPresets.orgAdmin(ORG), organizationId: ORG }, stub);
  assert.strictEqual(missing.status, 404);
});
