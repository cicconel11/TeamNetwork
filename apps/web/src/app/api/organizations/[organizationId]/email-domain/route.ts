import { NextResponse } from "next/server";
import { validateJson, ValidationError } from "@/lib/security/validation";
import { emailDomainCreateSchema, emailDomainUpdateSchema } from "@/lib/schemas";
import {
  createDomain,
  isEmailDomainServiceConfigured,
  removeDomain,
} from "@/lib/notifications/email-domains";
import { invalidateSenderCache } from "@/lib/notifications/sender";
import {
  emailDomainsTable,
  guardEmailDomainAdmin,
  refreshFromResend,
  serializeEmailDomain,
  type EmailDomainRow,
} from "./shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

/** How stale a non-verified status may get before GET re-polls Resend. */
const STATUS_REFRESH_MS = 60_000;

export async function GET(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const guard = await guardEmailDomainAdmin(req, organizationId, {
    feature: "org email domain read",
    limitPerIp: 60,
    limitPerUser: 40,
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
    return respond({ emailDomain: null });
  }

  let row = data as EmailDomainRow;
  const lastChecked = row.last_checked_at ? new Date(row.last_checked_at).getTime() : 0;
  const stale = Date.now() - lastChecked > STATUS_REFRESH_MS;
  if (row.status !== "verified" && stale && row.resend_domain_id) {
    row = await refreshFromResend(service, row);
  }

  return respond({ emailDomain: serializeEmailDomain(row) });
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const guard = await guardEmailDomainAdmin(req, organizationId, {
    feature: "org email domain create",
    limitPerIp: 10,
    limitPerUser: 5,
    blockReadOnly: true,
  });
  if (guard instanceof NextResponse) return guard;
  const { respond, service, userId } = guard;

  if (!isEmailDomainServiceConfigured() && process.env.NODE_ENV === "production") {
    return respond({ error: "Email service not configured" }, 503);
  }

  let input;
  try {
    input = await validateJson(req, emailDomainCreateSchema);
  } catch (err) {
    const message = err instanceof ValidationError ? err.message : "Invalid request body";
    return respond({ error: message }, 400);
  }

  const { data: existing } = await emailDomainsTable(service)
    .select("id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (existing) {
    return respond(
      { error: "This organization already has an email domain. Remove it before adding another." },
      409
    );
  }

  const { data: claimed } = await emailDomainsTable(service)
    .select("id, organization_id")
    .eq("domain", input.domain)
    .maybeSingle();
  if (claimed) {
    return respond({ error: "This domain is already claimed by another organization." }, 409);
  }

  let snapshot;
  try {
    snapshot = await createDomain(input.domain);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to register domain";
    return respond({ error: message }, 502);
  }

  const { data: inserted, error: insertError } = await emailDomainsTable(service)
    .insert({
      organization_id: organizationId,
      domain: input.domain,
      resend_domain_id: snapshot.id,
      status: snapshot.status,
      dns_records: snapshot.records,
      sender_local_part: input.senderLocalPart ?? "noreply",
      sender_display_name: input.senderDisplayName || null,
      last_checked_at: new Date().toISOString(),
      created_by: userId,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    // Don't leave an orphaned domain behind in Resend.
    await removeDomain(snapshot.id).catch(() => undefined);
    if (insertError?.code === "23505") {
      return respond({ error: "This domain is already claimed by another organization." }, 409);
    }
    return respond({ error: insertError?.message ?? "Failed to save domain" }, 500);
  }

  return respond({ emailDomain: serializeEmailDomain(inserted as EmailDomainRow) }, 201);
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const guard = await guardEmailDomainAdmin(req, organizationId, {
    feature: "org email domain update",
    limitPerIp: 20,
    limitPerUser: 10,
    blockReadOnly: true,
  });
  if (guard instanceof NextResponse) return guard;
  const { respond, service } = guard;

  let input;
  try {
    input = await validateJson(req, emailDomainUpdateSchema);
  } catch (err) {
    const message = err instanceof ValidationError ? err.message : "Invalid request body";
    return respond({ error: message }, 400);
  }

  const updates: Record<string, unknown> = {};
  if (input.senderLocalPart !== undefined) updates.sender_local_part = input.senderLocalPart;
  if (input.senderDisplayName !== undefined) updates.sender_display_name = input.senderDisplayName;

  const { data, error } = await emailDomainsTable(service)
    .update(updates)
    .eq("organization_id", organizationId)
    .select("*")
    .maybeSingle();

  if (error) {
    return respond({ error: error.message }, 500);
  }
  if (!data) {
    return respond({ error: "No email domain configured for this organization." }, 404);
  }

  invalidateSenderCache(organizationId);
  return respond({ emailDomain: serializeEmailDomain(data as EmailDomainRow) });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const guard = await guardEmailDomainAdmin(req, organizationId, {
    feature: "org email domain delete",
    limitPerIp: 10,
    limitPerUser: 5,
    blockReadOnly: true,
  });
  if (guard instanceof NextResponse) return guard;
  const { respond, service } = guard;

  const { data } = await emailDomainsTable(service)
    .select("id, resend_domain_id")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!data) {
    return respond({ error: "No email domain configured for this organization." }, 404);
  }

  const row = data as Pick<EmailDomainRow, "id" | "resend_domain_id">;
  if (row.resend_domain_id) {
    try {
      await removeDomain(row.resend_domain_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove domain from Resend";
      return respond({ error: message }, 502);
    }
  }

  const { error: deleteError } = await emailDomainsTable(service).delete().eq("id", row.id);
  if (deleteError) {
    return respond({ error: deleteError.message }, 500);
  }

  invalidateSenderCache(organizationId);
  return respond({ success: true });
}
