import { revalidateTag } from "next/cache";
import { z } from "zod";
import { validateJson, ValidationError } from "@/lib/security/validation";
import { validateAlumniImportRequest } from "@/lib/alumni/validate-import-request";
import { IMPORT_STATUS, resolveUnmatchedEmailsByUserId, type ImportResultBase } from "@/lib/alumni/import-utils";
import {
  planLinkedInImport,
  type LinkedInImportPreviewStatus,
} from "@/lib/alumni/linkedin-import";
import { linkedInProfileUrlSchema } from "@/lib/alumni/linkedin-url";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const importRowSchema = z.object({
  email: z.string().trim().email().max(320),
  linkedin_url: linkedInProfileUrlSchema,
});

const importBodySchema = z.object({
  rows: z.array(importRowSchema).min(1).max(500),
  overwrite: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImportResult extends ImportResultBase {
  preview?: Record<string, LinkedInImportPreviewStatus>;
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
  const importStartedAt = new Date().toISOString();
  const { organizationId: rawOrgId } = await params;

  const gate = await validateAlumniImportRequest(req, rawOrgId, {
    featurePreview: "alumni-linkedin-preview",
    featureImport: "alumni-linkedin-import",
  });
  if (!gate.ok) return gate.response;

  const { organizationId, serviceSupabase, capacitySnapshot, respond } = gate;

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

  const resolvedByUserId = await resolveUnmatchedEmailsByUserId({
    unmatchedEmails,
    organizationId,
    serviceSupabase,
    existingKeys: new Set(alumniByEmail.keys()),
    selectColumns: "id, user_id, linkedin_url",
    buildValue: (alum) => ({
      id: alum.id as string,
      linkedin_url: (alum.linkedin_url as string | null) ?? null,
    }),
  });
  for (const [email, value] of resolvedByUserId) {
    alumniByEmail.set(email, value);
  }

  const importPlan = planLinkedInImport({
    rows,
    overwrite,
    dryRun,
    alumniByEmail,
    remainingCapacity: capacitySnapshot.remainingCapacity,
  });

  // If dry run, return preview immediately (mirrors CSV route pattern)
  if (dryRun) {
    const result: ImportResult = {
      created: importPlan.toCreate.length,
      updated: importPlan.toUpdate.length,
      skipped: importPlan.skipped,
      quotaBlocked: importPlan.quotaBlocked,
      errors: [],
      preview: importPlan.preview,
    };
    return respond(result);
  }

  const errors: string[] = [];
  let updateErrors = 0;
  let created = 0;
  let concurrentUpdates = 0;
  let quotaBlocked = importPlan.quotaBlocked;
  let skipped = importPlan.skipped;

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
        if (row.out_status === IMPORT_STATUS.CREATED) {
          created++;
        } else if (row.out_status === IMPORT_STATUS.UPDATED_EXISTING) {
          concurrentUpdates++;
        } else if (row.out_status === IMPORT_STATUS.SKIPPED_EXISTING) {
          skipped++;
        } else if (row.out_status === IMPORT_STATUS.QUOTA_EXCEEDED) {
          quotaBlocked++;
        }
      }
    }
  }

  // Queue enrichment for all created/updated alumni (all have linkedin_url)
  const alumniIdsForEnrichment: string[] = [];
  for (const item of importPlan.toUpdate) {
    alumniIdsForEnrichment.push(item.alumniId);
  }

  if (alumniIdsForEnrichment.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (serviceSupabase as any)
      .from("alumni")
      .update({
        enrichment_status: "pending",
        enrichment_snapshot_id: null,
        enrichment_retry_count: 0,
        enrichment_error: null,
      })
      .in("id", alumniIdsForEnrichment)
      .eq("organization_id", organizationId)
      .is("deleted_at", null);
  }

  // For newly created alumni, scope to records created during this request
  if (created > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (serviceSupabase as any)
      .from("alumni")
      .update({
        enrichment_status: "pending",
        enrichment_snapshot_id: null,
        enrichment_retry_count: 0,
        enrichment_error: null,
      })
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .is("enrichment_status", null)
      .not("linkedin_url", "is", null)
      .gte("created_at", importStartedAt);
  }

  const result: ImportResult = {
    updated: importPlan.toUpdate.length - updateErrors + concurrentUpdates,
    created,
    skipped,
    quotaBlocked,
    errors,
  };

  // Invalidate enterprise alumni stats cache if any alumni were written
  if (result.created > 0 || result.updated > 0) {
    const { data: orgEnterprise } = await serviceSupabase
      .from("organizations")
      .select("enterprise_id")
      .eq("id", organizationId)
      .maybeSingle();

    if (orgEnterprise?.enterprise_id) {
      revalidateTag(`enterprise-alumni-stats-${orgEnterprise.enterprise_id}`);
    }
  }

  return respond(result);
}
