import { NextResponse } from "next/server";
import { verifyDomain } from "@/lib/notifications/email-domains";
import { invalidateSenderCache } from "@/lib/notifications/sender";
import {
  emailDomainsTable,
  guardEmailDomainAdmin,
  serializeEmailDomain,
  type EmailDomainRow,
} from "../shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

/**
 * Triggers a Resend DNS verification check and persists the refreshed
 * status. Intentionally allowed in read-only mode — it only updates our
 * cached verification state, not org content.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const guard = await guardEmailDomainAdmin(req, organizationId, {
    feature: "org email domain verify",
    limitPerIp: 20,
    limitPerUser: 10,
  });
  if (guard instanceof NextResponse) return guard;
  const { respond, service } = guard;

  const { data, error } = await emailDomainsTable(service)
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    return respond({ error: error.message }, 500);
  }
  if (!data) {
    return respond({ error: "No email domain configured for this organization." }, 404);
  }

  const row = data as EmailDomainRow;
  if (!row.resend_domain_id) {
    return respond({ error: "Domain is not registered with the email service." }, 409);
  }

  let snapshot;
  try {
    snapshot = await verifyDomain(row.resend_domain_id, row.domain);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification check failed";
    return respond({ error: message }, 502);
  }

  const becameVerified = snapshot.status === "verified" && row.status !== "verified";
  const lostVerification = snapshot.status !== "verified" && row.status === "verified";
  const updates: Record<string, unknown> = {
    status: snapshot.status,
    dns_records: snapshot.records,
    last_checked_at: new Date().toISOString(),
  };
  if (becameVerified) updates.verified_at = new Date().toISOString();
  if (lostVerification) updates.verified_at = null;

  const { data: updated, error: updateError } = await emailDomainsTable(service)
    .update(updates)
    .eq("id", row.id)
    .select("*")
    .maybeSingle();

  if (becameVerified || lostVerification) {
    invalidateSenderCache(organizationId);
  }

  if (updateError || !updated) {
    return respond({ error: updateError?.message ?? "Failed to save verification status" }, 500);
  }

  return respond({ emailDomain: serializeEmailDomain(updated as EmailDomainRow) });
}
