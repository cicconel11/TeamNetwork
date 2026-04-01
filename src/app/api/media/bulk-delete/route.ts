import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateJson, ValidationError, validationErrorResponse, baseSchemas } from "@/lib/security/validation";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { softDeleteMediaItems } from "@/lib/media/delete-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bulkDeleteSchema = z.object({
  orgId: baseSchemas.uuid,
  mediaIds: z.array(baseSchemas.uuid).min(1).max(100),
});

/**
 * POST /api/media/bulk-delete
 * Soft-delete multiple media items. Auth: admin or uploader of ALL items.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    limitPerIp: 20,
    limitPerUser: 10,
    userId: user?.id ?? null,
    feature: "media-bulk-delete",
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
  }

  let body: z.infer<typeof bulkDeleteSchema>;
  try {
    body = await validateJson(req, bulkDeleteSchema);
  } catch (error) {
    if (error instanceof ValidationError) return validationErrorResponse(error);
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: rateLimit.headers });
  }

  const { orgId, mediaIds } = body;

  // Check org membership
  const membership = await getOrgMembership(supabase, user.id, orgId);
  if (!membership) {
    return NextResponse.json(
      { error: "Not a member of this organization" },
      { status: 403, headers: rateLimit.headers },
    );
  }

  const isAdmin = membership.role === "admin";

  // Read-only check
  const { isReadOnly } = await checkOrgReadOnly(orgId);
  if (isReadOnly) {
    return NextResponse.json(readOnlyResponse(), { status: 403, headers: rateLimit.headers });
  }

  const serviceClient = createServiceClient();
  const deletion = await softDeleteMediaItems(serviceClient, {
    orgId,
    mediaIds,
    actor: { isAdmin, userId: user.id },
    forbiddenMessage: "You can only bulk-delete your own media",
  });

  if (!deletion.ok) {
    return NextResponse.json(
      { error: deletion.error },
      { status: deletion.status, headers: rateLimit.headers },
    );
  }

  return NextResponse.json(
    { deleted: deletion.deletedIds.length, deletedIds: deletion.deletedIds },
    { headers: rateLimit.headers },
  );
}
