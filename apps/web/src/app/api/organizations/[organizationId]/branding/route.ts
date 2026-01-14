import { randomUUID } from "crypto";
import { extname } from "path";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { normalizeRole } from "@/lib/auth/role-utils";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import type { UserRole } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

function normalizeHexColor(value: FormDataEntryValue | null): { color: string | null; invalid: boolean } {
  if (!value || typeof value !== "string") return { color: null, invalid: false };
  const trimmed = value.trim();
  if (!trimmed) return { color: null, invalid: false };
  const match = trimmed.match(/^#([0-9a-fA-F]{6})$/);
  if (!match) return { color: null, invalid: true };
  return { color: `#${match[1].toLowerCase()}`, invalid: false };
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "org branding update",
    limitPerIp: 30,
    limitPerUser: 20,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return respond({ error: "Unauthorized" }, 401);
  }

  const { data: membership } = await supabase
    .from("user_organization_roles")
    .select("role,status")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  const role = normalizeRole((membership?.role as UserRole | null) ?? null);
  if (!role || role !== "admin" || membership?.status !== "active") {
    return respond({ error: "Forbidden" }, 403);
  }

  // Block mutations if org is in grace period (read-only mode)
  const { isReadOnly } = await checkOrgReadOnly(organizationId);
  if (isReadOnly) {
    return respond(readOnlyResponse(), 403);
  }

  const formData = await req.formData();
  const rawPrimary = formData.get("primaryColor");
  const rawSecondary = formData.get("secondaryColor");
  const primary = normalizeHexColor(rawPrimary);
  const secondary = normalizeHexColor(rawSecondary);
  const file = formData.get("logo");

  if (primary.invalid) {
    return respond({ error: "Primary color must be a 6-digit hex value like #1e3a5f." }, 400);
  }
  if (secondary.invalid) {
    return respond({ error: "Secondary color must be a 6-digit hex value like #10b981." }, 400);
  }

  const uploadFile = file instanceof File ? file : null;
  if (!uploadFile && !primary.color && !secondary.color) {
    return respond({ error: "Provide a logo or updated colors to save." }, 400);
  }

  if (uploadFile) {
    if (!ALLOWED_LOGO_TYPES.has(uploadFile.type)) {
      return respond({ error: "Logo must be a PNG, JPG, GIF, or WebP image." }, 400);
    }
    if (uploadFile.size > MAX_LOGO_BYTES) {
      return respond({ error: "Logo must be under 5MB." }, 400);
    }
  }

  const serviceSupabase = createServiceClient();
  const updates: Record<string, string | null> = {};

  if (primary.color) {
    updates.primary_color = primary.color;
  }
  if (secondary.color) {
    updates.secondary_color = secondary.color;
  }

  if (uploadFile) {
    const arrayBuffer = await uploadFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const extFromType = uploadFile.type.split("/")[1];
    const extFromName = extname(uploadFile.name || "").replace(".", "");
    const extension = (extFromType || extFromName || "png").toLowerCase();
    const storagePath = `${organizationId}/logo-${Date.now()}-${randomUUID()}.${extension}`;

    const { error: uploadError } = await serviceSupabase.storage
      .from("org-branding")
      .upload(storagePath, buffer, { contentType: uploadFile.type, upsert: true });

    if (uploadError) {
      return respond({ error: uploadError.message }, 400);
    }

    const { data: publicUrl } = serviceSupabase.storage.from("org-branding").getPublicUrl(storagePath);
    updates.logo_url = publicUrl.publicUrl;
  }

  if (Object.keys(updates).length === 0) {
    return respond({ error: "Nothing to update." }, 400);
  }

  const { data: updatedOrg, error: updateError } = await serviceSupabase
    .from("organizations")
    .update(updates)
    .eq("id", organizationId)
    .select("id, name, slug, logo_url, primary_color, secondary_color")
    .maybeSingle();

  if (updateError) {
    return respond({ error: updateError.message }, 400);
  }

  if (!updatedOrg) {
    return respond({ error: "Organization not found" }, 404);
  }

  return respond({ organization: updatedOrg });
}
