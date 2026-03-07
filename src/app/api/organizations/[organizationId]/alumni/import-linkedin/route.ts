import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas } from "@/lib/security/validation";
import { getAlumniCapacitySnapshot } from "@/lib/alumni/capacity";
import {
  planLinkedInImport,
  type LinkedInImportPreviewStatus,
} from "@/lib/alumni/linkedin-import";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const linkedinUrlSchema = z
  .string()
  .trim()
  .transform((val) => {
    try {
      const url = new URL(val);
      if (url.protocol === "http:") {
        url.protocol = "https:";
      }
      if (url.hostname === "linkedin.com") {
        url.hostname = "www.linkedin.com";
      }
      return url.toString().replace(/\/+$/, "");
    } catch {
      return val;
    }
  })
  .refine(
    (val) => {
      try {
        const url = new URL(val);
        return (
          url.protocol === "https:" &&
          url.hostname === "www.linkedin.com" &&
          /^\/in\/[a-zA-Z0-9_-]+/.test(url.pathname)
        );
      } catch {
        return false;
      }
    },
    { message: "Must be a valid LinkedIn profile URL (linkedin.com/in/...)" },
  );

const importRowSchema = z.object({
  email: z.string().trim().email().max(320),
  linkedin_url: linkedinUrlSchema,
});

const importBodySchema = z.object({
  rows: z.array(importRowSchema).min(1).max(500),
  overwrite: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImportResult {
  updated: number;
  created: number;
  skipped: number;
  quotaBlocked: number;
  errors: string[];
  preview?: Record<string, LinkedInImportPreviewStatus>;
}

interface AuthUsersQuery {
  schema: (schema: "auth") => {
    from: (table: "users") => {
      select: (columns: "id, email") => {
        in: (
          column: "email",
          values: string[],
        ) => Promise<{ data: Array<{ id: string; email: string }> | null }>;
      };
    };
  };
}

interface BulkImportLinkedInRpc {
  rpc: (
    fn: "bulk_import_linkedin_alumni",
    params: {
      p_organization_id: string;
      p_rows: Array<{
        email: string;
        first_name: string;
        last_name: string;
        linkedin_url: string;
      }>;
      p_overwrite: boolean;
    },
  ) => Promise<{
    data: Array<{ out_email: string; out_status: string }> | null;
    error: { message: string } | null;
  }>;
}

// ─── Route ───────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Split rate-limit bucket based on preview vs import
  const isPreview = new URL(req.url).searchParams.get("preview") === "1";
  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: isPreview ? "alumni-linkedin-preview" : "alumni-linkedin-import",
    limitPerIp: 15,
    limitPerUser: 10,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return respond({ error: "Unauthorized" }, 401);
  }

  // Layer 2: API role check (authoritative security boundary)
  const serviceSupabase = createServiceClient();
  const { data: roleData, error: roleError } = await serviceSupabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (roleError) {
    console.error("[alumni/import-linkedin POST] Failed to fetch role:", roleError);
    return respond({ error: "Unable to verify permissions" }, 500);
  }

  if (roleData?.role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  let body: z.infer<typeof importBodySchema>;
  try {
    body = await validateJson(req, importBodySchema, { maxBodyBytes: 200_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const { rows, overwrite, dryRun } = body;

  // Deduplication is handled by planLinkedInImport via normalizeLinkedInImportRows

  // Fetch alumni by email for this org (Layer 3: org-scoped query)
  const emails = [...new Set(rows.map((r) => r.email.toLowerCase()))];
  const { data: alumniData, error: alumniError } = await serviceSupabase
    .from("alumni")
    .select("id, email, linkedin_url")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("email", emails);

  if (alumniError) {
    console.error("[alumni/import-linkedin POST] Failed to fetch alumni:", alumniError);
    return respond({ error: "Failed to fetch alumni records" }, 500);
  }

  // Build email→alumni lookup
  const alumniByEmail = new Map<string, { id: string; linkedin_url: string | null }>();
  for (const alumni of alumniData ?? []) {
    if (alumni.email) {
      alumniByEmail.set(alumni.email.toLowerCase(), {
        id: alumni.id,
        linkedin_url: alumni.linkedin_url,
      });
    }
  }

  // Fallback: look up unmatched emails via auth.users → alumni.user_id
  const unmatchedEmails = emails.filter((e) => !alumniByEmail.has(e));

  if (unmatchedEmails.length > 0) {
    const authSupabase = serviceSupabase as unknown as AuthUsersQuery;
    const { data: authUsers } = await authSupabase
      .schema("auth")
      .from("users")
      .select("id, email")
      .in("email", unmatchedEmails);

    if (authUsers && authUsers.length > 0) {
      const userIds = authUsers.map((u: { id: string }) => u.id);
      const userIdToEmail = new Map(
        authUsers.map((u: { id: string; email: string }) => [u.id, u.email.toLowerCase()]),
      );

      const { data: linkedAlumni } = await serviceSupabase
        .from("alumni")
        .select("id, user_id, linkedin_url")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .in("user_id", userIds);

      for (const alum of linkedAlumni ?? []) {
        if (!alum.user_id) continue;
        const email = userIdToEmail.get(alum.user_id);
        if (email && !alumniByEmail.has(email)) {
          alumniByEmail.set(email, { id: alum.id, linkedin_url: alum.linkedin_url });
        }
      }
    }
  }

  // Alumni quota check for new record creation
  let capacitySnapshot;
  try {
    capacitySnapshot = await getAlumniCapacitySnapshot(organizationId);
  } catch (error) {
    console.error("[alumni/import-linkedin POST] Failed to count alumni:", error);
    return respond({ error: "Failed to verify alumni capacity" }, 500);
  }
  const importPlan = planLinkedInImport({
    rows,
    overwrite,
    dryRun,
    alumniByEmail,
    remainingCapacity: capacitySnapshot.remainingCapacity,
  });

  const errors: string[] = [];
  let updateErrors = 0;
  let created = 0;
  let concurrentUpdates = 0;
  let quotaBlocked = importPlan.quotaBlocked;
  let skipped = importPlan.skipped;

  // Skip batch writes in dry run mode
  if (!dryRun) {
    const BATCH_SIZE = 20;

    // Batch updates
    for (let i = 0; i < importPlan.toUpdate.length; i += BATCH_SIZE) {
      const batch = importPlan.toUpdate.slice(i, i + BATCH_SIZE);
      const updates = batch.map((item) =>
        serviceSupabase
          .from("alumni")
          .update({ linkedin_url: item.linkedinUrl })
          .eq("id", item.alumniId)
          .eq("organization_id", organizationId),
      );

      const results = await Promise.all(updates);
      for (const { error } of results) {
        if (error) {
          updateErrors++;
          errors.push(error.message);
        }
      }
    }

    if (importPlan.toCreate.length > 0) {
      const rpcSupabase = serviceSupabase as unknown as BulkImportLinkedInRpc;
      const { data: createResults, error: createError } = await rpcSupabase.rpc(
        "bulk_import_linkedin_alumni",
        {
          p_organization_id: organizationId,
          p_rows: importPlan.toCreate.map((item) => ({
            email: item.email,
            first_name: item.first_name,
            last_name: item.last_name,
            linkedin_url: item.linkedinUrl,
          })),
          p_overwrite: overwrite,
        },
      );

      if (createError) {
        console.error("[alumni/import-linkedin POST] RPC bulk_import_linkedin_alumni failed:", createError);
        errors.push(createError.message);
      } else {
        for (const row of createResults ?? []) {
          if (row.out_status === "created") {
            created++;
          } else if (row.out_status === "updated_existing") {
            concurrentUpdates++;
          } else if (row.out_status === "skipped_existing") {
            skipped++;
          } else if (row.out_status === "quota_exceeded") {
            quotaBlocked++;
          }
        }
      }
    }
  }

  const result: ImportResult = {
    updated: importPlan.toUpdate.length - updateErrors + concurrentUpdates,
    created,
    skipped,
    quotaBlocked,
    errors,
  };

  if (dryRun) {
    result.created = importPlan.toCreate.length;
    result.updated = importPlan.toUpdate.length;
    result.preview = importPlan.preview;
  }

  return respond(result);
}
