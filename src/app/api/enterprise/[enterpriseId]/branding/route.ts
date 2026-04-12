import { randomUUID } from "crypto";
import { extname } from "path";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  getEnterpriseApiContext,
  ENTERPRISE_ANY_ROLE,
} from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

// Magic bytes for image format validation (prevents MIME type spoofing)
const IMAGE_MAGIC_BYTES: Record<string, number[][]> = {
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/jpg": [[0xff, 0xd8, 0xff]],
  "image/gif": [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]], // RIFF header (WebP starts with RIFF....WEBP)
};

/**
 * Validates that the file content matches its declared MIME type.
 * This prevents attackers from uploading malicious files with spoofed MIME types.
 */
function validateImageMagicBytes(buffer: Buffer, declaredType: string): boolean {
  const signatures = IMAGE_MAGIC_BYTES[declaredType];
  if (!signatures) return false;

  for (const signature of signatures) {
    if (buffer.length < signature.length) continue;
    const matches = signature.every((byte, i) => buffer[i] === byte);
    if (matches) {
      // Additional check for WebP: verify WEBP signature at offset 8
      if (declaredType === "image/webp") {
        if (buffer.length >= 12) {
          const webpSig = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
          const webpMatches = webpSig.every((byte, i) => buffer[8 + i] === byte);
          return webpMatches;
        }
        return false;
      }
      return true;
    }
  }
  return false;
}

function normalizeHexColor(value: FormDataEntryValue | null): { color: string | null; invalid: boolean } {
  if (!value || typeof value !== "string") return { color: null, invalid: false };
  const trimmed = value.trim();
  if (!trimmed) return { color: null, invalid: false };
  const match = trimmed.match(/^#([0-9a-fA-F]{6})$/);
  if (!match) return { color: null, invalid: true };
  return { color: `#${match[1].toLowerCase()}`, invalid: false };
}

export async function POST(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise branding update",
    limitPerIp: 30,
    limitPerUser: 20,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_ANY_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  const formData = await req.formData();
  const rawPrimary = formData.get("primaryColor");
  const primary = normalizeHexColor(rawPrimary);
  const file = formData.get("logo");

  if (primary.invalid) {
    return respond({ error: "Brand color must be a 6-digit hex value like #6B21A8." }, 400);
  }

  const uploadFile = file instanceof File ? file : null;
  if (!uploadFile && !primary.color) {
    return respond({ error: "Provide a logo or updated color to save." }, 400);
  }

  // Validate file before processing
  let uploadBuffer: Buffer | null = null;
  if (uploadFile) {
    // Check declared MIME type
    if (!ALLOWED_LOGO_TYPES.has(uploadFile.type)) {
      return respond({ error: "Logo must be a PNG, JPG, GIF, or WebP image." }, 400);
    }
    // Check file size
    if (uploadFile.size > MAX_LOGO_BYTES) {
      return respond({ error: "Logo must be under 5MB." }, 400);
    }

    // Read file content for validation
    const arrayBuffer = await uploadFile.arrayBuffer();
    uploadBuffer = Buffer.from(arrayBuffer);

    // Validate magic bytes match declared MIME type (prevents MIME spoofing attacks)
    if (!validateImageMagicBytes(uploadBuffer, uploadFile.type)) {
      return respond(
        { error: "File content does not match declared image type. Please upload a valid image file." },
        400
      );
    }
  }

  const updates: Record<string, string | null> = {};

  if (primary.color) {
    updates.primary_color = primary.color;
  }

  if (uploadFile && uploadBuffer) {
    const extFromType = uploadFile.type.split("/")[1];
    const extFromName = extname(uploadFile.name || "").replace(".", "");
    const extension = (extFromType || extFromName || "png").toLowerCase();
    const storagePath = `${ctx.enterpriseId}/logo-${Date.now()}-${randomUUID()}.${extension}`;

    const { error: uploadError } = await ctx.serviceSupabase.storage
      .from("enterprise-branding")
      .upload(storagePath, uploadBuffer, { contentType: uploadFile.type, upsert: true });

    if (uploadError) {
      return respond({ error: uploadError.message }, 400);
    }

    const { data: publicUrl } = ctx.serviceSupabase.storage.from("enterprise-branding").getPublicUrl(storagePath);
    updates.logo_url = publicUrl.publicUrl;
  }

  if (Object.keys(updates).length === 0) {
    return respond({ error: "Nothing to update." }, 400);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updatedEnterprise, error: updateError } = await (ctx.serviceSupabase as any)
    .from("enterprises")
    .update(updates)
    .eq("id", ctx.enterpriseId)
    .select("id, name, slug, logo_url, primary_color")
    .maybeSingle();

  if (updateError) {
    return respond({ error: updateError.message }, 400);
  }

  if (!updatedEnterprise) {
    return respond({ error: "Enterprise not found" }, 404);
  }

  logEnterpriseAuditAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.userEmail,
    action: "update_branding",
    enterpriseId: ctx.enterpriseId,
    targetType: "enterprise",
    targetId: ctx.enterpriseId,
    metadata: { updatedFields: Object.keys(updates) },
    ...extractRequestContext(req),
  });

  return respond({ enterprise: updatedEnterprise });
}
