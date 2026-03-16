/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { validateJson, ValidationError } from "@/lib/security/validation";
import { sendEmail } from "@/lib/notifications";
import { validateAlumniImportRequest } from "@/lib/alumni/validate-import-request";
import { getAppUrl } from "@/lib/url";
import { IMPORT_STATUS, resolveUnmatchedEmailsByUserId, type ImportResultBase } from "@/lib/alumni/import-utils";
import {
  planCsvImport,
  type CsvImportPreviewStatus,
  type CsvImportRow,
} from "@/lib/alumni/csv-import";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const importRowSchema = z.object({
  first_name: z.string().trim().min(1).max(200),
  last_name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).optional().nullable(),
  graduation_year: z.number().int().min(1900).max(2100).optional().nullable(),
  major: z.string().trim().max(200).optional().nullable(),
  job_title: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  linkedin_url: z
    .string()
    .trim()
    .url()
    .refine((val) => val.startsWith("https://"), { message: "LinkedIn URL must use HTTPS" })
    .optional()
    .nullable(),
  phone_number: z.string().trim().max(50).optional().nullable(),
  industry: z.string().trim().max(200).optional().nullable(),
  current_company: z.string().trim().max(200).optional().nullable(),
  current_city: z.string().trim().max(200).optional().nullable(),
  position_title: z.string().trim().max(200).optional().nullable(),
});

const importBodySchema = z.object({
  rows: z.array(importRowSchema).min(1).max(500),
  overwrite: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
  sendInvites: z.boolean().optional().default(false),
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImportResult extends ImportResultBase {
  preview?: Record<string, CsvImportPreviewStatus>;
  emailsSent?: number;
  emailErrors?: number;
}

interface BulkImportAlumniRichRpc {
  rpc: (
    fn: "bulk_import_alumni_rich",
    params: {
      p_organization_id: string;
      p_rows: Array<{
        first_name: string;
        last_name: string;
        email?: string | null;
        graduation_year?: number | null;
        major?: string | null;
        job_title?: string | null;
        notes?: string | null;
        linkedin_url?: string | null;
        phone_number?: string | null;
        industry?: string | null;
        current_company?: string | null;
        current_city?: string | null;
        position_title?: string | null;
      }>;
      p_overwrite: boolean;
    },
  ) => Promise<{
    data: Array<{ out_email: string; out_first_name: string; out_last_name: string; out_status: string }> | null;
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
  const { organizationId: rawOrgId } = await params;

  const gate = await validateAlumniImportRequest(req, rawOrgId, {
    featurePreview: "alumni-csv-preview",
    featureImport: "alumni-csv-import",
    importLimitPerIp: 10,
    importLimitPerUser: 5,
  });
  if (!gate.ok) return gate.response;

  const { organizationId, userSupabase, serviceSupabase, capacitySnapshot, respond } = gate;

  let body: z.infer<typeof importBodySchema>;
  try {
    body = await validateJson(req, importBodySchema, { maxBodyBytes: 500_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const { rows, overwrite, dryRun, sendInvites } = body;

  // Fetch alumni by email for this org (Layer 3: org-scoped query)
  const emailsInRequest = [
    ...new Set(
      rows
        .filter((r) => r.email)
        .map((r) => r.email!.toLowerCase()),
    ),
  ];

  const alumniByEmail = new Map<string, { id: string; hasData: boolean }>();

  if (emailsInRequest.length > 0) {
    const { data: alumniData, error: alumniError } = await serviceSupabase
      .from("alumni")
      .select("id, email, first_name, last_name, graduation_year, major, job_title, notes, linkedin_url, phone_number, industry, current_company, current_city, position_title")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .in("email", emailsInRequest);

    if (alumniError) {
      console.error("[alumni/import-csv POST] Failed to fetch alumni:", alumniError);
      return respond({ error: "Failed to fetch alumni records" }, 500);
    }

    for (const alum of alumniData ?? []) {
      if (alum.email) {
        const hasData = !!(
          alum.first_name || alum.last_name || alum.graduation_year ||
          alum.major || alum.job_title || alum.notes || alum.linkedin_url ||
          alum.phone_number || alum.industry || alum.current_company ||
          alum.current_city || alum.position_title
        );
        alumniByEmail.set(alum.email.toLowerCase(), { id: alum.id, hasData });
      }
    }

    // Fallback: look up unmatched emails via auth.users → alumni.user_id
    const unmatchedEmails = emailsInRequest.filter((e) => !alumniByEmail.has(e));

    const resolvedByUserId = await resolveUnmatchedEmailsByUserId({
      unmatchedEmails,
      organizationId,
      serviceSupabase,
      existingKeys: new Set(alumniByEmail.keys()),
      selectColumns: "id, user_id, first_name, last_name, graduation_year, major, job_title, notes, linkedin_url, phone_number, industry, current_company, current_city, position_title",
      buildValue: (alum) => ({
        id: alum.id as string,
        hasData: !!(
          alum.first_name || alum.last_name || alum.graduation_year ||
          alum.major || alum.job_title || alum.notes || alum.linkedin_url ||
          alum.phone_number || alum.industry || alum.current_company ||
          alum.current_city || alum.position_title
        ),
      }),
    });
    for (const [email, value] of resolvedByUserId) {
      alumniByEmail.set(email, value);
    }
  }

  const importPlan = planCsvImport({
    rows: rows as CsvImportRow[],
    overwrite,
    alumniByEmail,
    remainingCapacity: capacitySnapshot.remainingCapacity,
  });

  // If dry run, return preview immediately
  if (dryRun) {
    const previewMap: Record<string, CsvImportPreviewStatus> = {};
    for (const previewRow of importPlan.preview) {
      // Always key by rowIndex to avoid duplicate emails overwriting each other
      previewMap[`row:${previewRow.rowIndex}`] = previewRow.status;
    }

    const result: ImportResult = {
      created: importPlan.toCreate.length,
      updated: importPlan.toUpdate.length,
      skipped: importPlan.skipped,
      quotaBlocked: importPlan.quotaBlocked,
      errors: [],
      preview: previewMap,
    };
    return respond(result);
  }

  const errors: string[] = [];
  let updateErrors = 0;
  let created = 0;
  let concurrentUpdates = 0;
  let quotaBlocked = importPlan.quotaBlocked;
  let skipped = importPlan.skipped;

  // Batch updates (20 at a time)
  const BATCH_SIZE = 20;
  for (let i = 0; i < importPlan.toUpdate.length; i += BATCH_SIZE) {
    const batch = importPlan.toUpdate.slice(i, i + BATCH_SIZE);
    const updates = batch.map(({ alumniId, data }) =>
      serviceSupabase
        .from("alumni")
        .update(data)
        .eq("id", alumniId)
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

  // Bulk create via RPC
  type CreatedRecord = { out_email: string; out_first_name: string; out_last_name: string; out_status: string };
  const createdRecords: CreatedRecord[] = [];

  if (importPlan.toCreate.length > 0) {
    const rpcSupabase = serviceSupabase as unknown as BulkImportAlumniRichRpc;
    const { data: createResults, error: createError } = await rpcSupabase.rpc("bulk_import_alumni_rich", {
      p_organization_id: organizationId,
      p_rows: importPlan.toCreate,
      p_overwrite: overwrite,
    });

    if (createError) {
      console.error("[alumni/import-csv POST] RPC bulk_import_alumni_rich failed:", createError);
      errors.push(createError.message);
    } else {
      for (const row of createResults ?? []) {
        if (row.out_status === IMPORT_STATUS.CREATED) {
          created++;
          createdRecords.push(row);
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

  // Phase 2: Send invite emails if requested
  if (sendInvites && createdRecords.length > 0) {
    const createdWithEmail = createdRecords.filter((r) => r.out_email);

    if (createdWithEmail.length > 0) {
      // Create org invite with limited uses
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: invite, error: inviteError } = await (userSupabase as any).rpc("create_org_invite", {
        p_organization_id: organizationId,
        p_role: "alumni",
        p_uses: createdWithEmail.length,
        p_expires_at: null,
      });

      if (inviteError || !invite) {
        console.error("[alumni/import-csv POST] Failed to create invite for emails:", inviteError);
        result.emailErrors = createdWithEmail.length;
      } else {
        // Fetch org name and slug for the email
        const { data: orgData } = await serviceSupabase
          .from("organizations")
          .select("name, slug")
          .eq("id", organizationId)
          .maybeSingle();

        const orgName = orgData?.name ?? "your alumni network";
        const appUrl = getAppUrl();
        const joinLink = `${appUrl}/app/join?code=${invite.token}`;

        const emailTasks = createdWithEmail.map(
          (record) => () =>
            sendEmail({
              to: record.out_email,
              subject: `You've been added to ${orgName}'s alumni network`,
              body: [
                `Hi ${record.out_first_name},`,
                "",
                `You've been added to ${orgName}'s alumni network on TeamNetwork.`,
                "",
                `Click the link below to join and access your alumni profile:`,
                joinLink,
                "",
                "If you have any questions, reply to this email.",
                "",
                "Best regards,",
                `The ${orgName} Team`,
              ].join("\n"),
            }),
        );

        const CONCURRENCY = 10;
        let sent = 0;
        let emailErrorCount = 0;

        for (let i = 0; i < emailTasks.length; i += CONCURRENCY) {
          const batch = emailTasks.slice(i, i + CONCURRENCY).map((task) => task());
          const batchResults = await Promise.allSettled(batch);
          for (const res of batchResults) {
            if (res.status === "fulfilled" && res.value.success) {
              sent++;
            } else {
              emailErrorCount++;
            }
          }
        }

        result.emailsSent = sent;
        result.emailErrors = emailErrorCount;
      }
    }
  }

  return respond(result);
}
