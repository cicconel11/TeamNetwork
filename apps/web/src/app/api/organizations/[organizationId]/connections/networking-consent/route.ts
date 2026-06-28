import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { normalizeRole } from "@/lib/auth/role-utils";
import { CHAT_ELIGIBLE_ORG_ROLES } from "@/lib/chat/recipient-eligibility";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas, validateJson, ValidationError } from "@/lib/security/validation";
import type { UserRole } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

const consentSchema = z.object({
  open_to_networking: z.boolean(),
});

// The viewer's own people-row across the three person tables. Order matters only
// for reading back a single current value; a write updates every owned row so the
// flag stays consistent if a user is both (e.g.) a member and a parent.
const PERSON_TABLES = ["members", "alumni", "parents"] as const;

async function authorize(req: Request, organizationId: string) {
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return { ok: false as const, response: NextResponse.json({ error: "Invalid identifier" }, { status: 400 }) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    orgId: organizationId,
    feature: "networking consent",
    limitPerIp: 40,
    limitPerUser: 20,
  });
  if (!rateLimit.ok) {
    return { ok: false as const, response: buildRateLimitResponse(rateLimit) };
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return { ok: false as const, response: respond({ error: "Unauthorized" }, 401) };
  }

  const serviceSupabase = createServiceClient();
  let membership;
  try {
    membership = await getOrgMembership(serviceSupabase, user.id, organizationId);
  } catch (error) {
    console.error("[networking-consent] Failed to verify membership:", error);
    return { ok: false as const, response: respond({ error: "Unable to verify permissions" }, 500) };
  }

  const normalizedRole = normalizeRole((membership?.role as UserRole | null) ?? null);
  const isEligible =
    normalizedRole !== null &&
    (CHAT_ELIGIBLE_ORG_ROLES as readonly string[]).includes(normalizedRole);
  if (!isEligible) {
    return { ok: false as const, response: respond({ error: "Forbidden" }, 403) };
  }

  return { ok: true as const, supabase, user, respond };
}

// GET — current consent value for the viewer (true if any of their owned rows opted in).
export async function GET(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const auth = await authorize(req, organizationId);
  if (!auth.ok) return auth.response;

  const { supabase, user, respond } = auth;
  let optedIn = false;
  for (const table of PERSON_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from(table)
      .select("open_to_networking")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .is("deleted_at", null);
    if (error) {
      console.error(`[networking-consent GET] Failed to read ${table}:`, error);
      return respond({ error: "Failed to load consent" }, 500);
    }
    if ((data ?? []).some((row: { open_to_networking?: boolean | null }) => row.open_to_networking === true)) {
      optedIn = true;
    }
  }

  return respond({ open_to_networking: optedIn });
}

// PATCH — set consent on every people-row the viewer owns in this org.
//
// The write runs on the USER (RLS) client: the column-level DB trigger requires
// auth.uid() = row.user_id, so a service-role write (no JWT) would be rejected.
// RLS + the trigger together guarantee a user can only flip their OWN flag.
export async function PATCH(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const auth = await authorize(req, organizationId);
  if (!auth.ok) return auth.response;

  const { supabase, user, respond } = auth;

  let body: z.infer<typeof consentSchema>;
  try {
    body = await validateJson(req, consentSchema, { maxBodyBytes: 2_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  let updatedRows = 0;
  for (const table of PERSON_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from(table)
      .update({ open_to_networking: body.open_to_networking })
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .select("id");
    if (error) {
      console.error(`[networking-consent PATCH] Failed to update ${table}:`, error);
      return respond({ error: "Failed to update consent" }, 500);
    }
    updatedRows += (data as unknown[] | null)?.length ?? 0;
  }

  // No owned row in any table — the viewer has no profile to opt in. Surface it
  // so the UI can prompt them to complete their profile rather than silently no-op.
  if (updatedRows === 0) {
    return respond({ error: "No profile to update", code: "no_profile" }, 409);
  }

  return respond({ open_to_networking: body.open_to_networking, updated: updatedRows });
}
