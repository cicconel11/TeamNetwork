import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import {
  getEnterpriseApiContext,
  ENTERPRISE_CREATE_ORG_ROLE,
} from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";
import { canEnterpriseAddSubOrgs } from "@/lib/enterprise/quota";
import { batchCreateOrgsSchema } from "@/lib/schemas/enterprise";
import { transferMemberRole } from "@/lib/enterprise/transfer-member";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

interface BatchOrgResult {
  out_slug: string;
  out_org_id: string | null;
  out_status: string;
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { enterpriseId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "batch create organizations",
      limitPerIp: 10,
      limitPerUser: 5,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_CREATE_ORG_ROLE);
    if (!ctx.ok) return ctx.response;

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    const body = await validateJson(req, batchCreateOrgsSchema, {
      maxBodyBytes: 65_536,
    });
    const { organizations, memberAssignments } = body;

    // Hard cap quota check for entire batch
    const quotaCheck = await canEnterpriseAddSubOrgs(
      ctx.enterpriseId,
      organizations.length
    );
    if (quotaCheck.error) {
      return respond({ error: "Unable to verify org quota" }, 503);
    }
    if (!quotaCheck.allowed) {
      return respond(
        {
          error: `Organization limit reached. You have ${quotaCheck.currentCount} of ${quotaCheck.maxAllowed} orgs. Cannot add ${organizations.length} more.`,
          needsUpgrade: true,
          currentCount: quotaCheck.currentCount,
          maxAllowed: quotaCheck.maxAllowed,
          remaining: quotaCheck.remaining,
        },
        402
      );
    }

    // Call batch creation RPC
    const orgsPayload = organizations.map((org) => ({
      name: org.name,
      slug: org.slug,
      description: org.description ?? null,
      purpose: org.purpose ?? null,
      primary_color: org.primary_color ?? null,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rpcResult, error: rpcError } = await (ctx.serviceSupabase as any).rpc(
      "batch_create_enterprise_orgs",
      {
        p_enterprise_id: ctx.enterpriseId,
        p_user_id: ctx.userId,
        p_orgs: orgsPayload,
      }
    ) as { data: BatchOrgResult[] | null; error: { message?: string; code?: string } | null };

    if (rpcError) {
      // Handle specific error codes
      if (rpcError.code === "23505" || rpcError.message?.includes("already taken")) {
        const slugMatch = rpcError.message?.match(/Slug "([^"]+)"/);
        return respond(
          {
            error: slugMatch
              ? `Slug "${slugMatch[1]}" is already taken`
              : "One or more slugs are already taken",
          },
          409
        );
      }
      if (rpcError.code === "P0001" && rpcError.message?.includes("org limit")) {
        return respond(
          { error: "Organization limit exceeded", needsUpgrade: true },
          402
        );
      }
      console.error("[batch-create] RPC error:", JSON.stringify(rpcError, null, 2));
      return respond({ error: "Failed to create organizations", detail: rpcError.message, code: rpcError.code }, 500);
    }

    const createdOrgs = (rpcResult ?? []).filter((r) => r.out_status === "created");
    const failedOrgs = (rpcResult ?? []).filter((r) => r.out_status !== "created");

    // Build slug → orgId lookup for member assignments
    const slugToOrgId = new Map(
      createdOrgs.map((r) => [r.out_slug, r.out_org_id!])
    );

    // Process member assignments
    const memberResults: Array<{
      orgSlug: string;
      userId: string;
      action: string;
      ok: boolean;
      error?: string;
    }> = [];

    if (memberAssignments && memberAssignments.length > 0) {
      // Check if any moves are requested — require owner role
      const hasMoves = memberAssignments.some(
        (a) => a.existingMembers?.some((m) => m.action === "move")
      );

      if (hasMoves && ctx.role !== "owner") {
        return respond(
          { error: "Moving members between organizations requires enterprise owner role" },
          403
        );
      }

      // Process in batches of 10
      for (const assignment of memberAssignments) {
        if (assignment.orgIndex >= organizations.length) continue;

        const orgSlug = organizations[assignment.orgIndex].slug;
        const targetOrgId = slugToOrgId.get(orgSlug);
        if (!targetOrgId) continue;

        // Process existing member transfers
        if (assignment.existingMembers && assignment.existingMembers.length > 0) {
          const members = assignment.existingMembers;
          const batchSize = 10;

          for (let i = 0; i < members.length; i += batchSize) {
            const batch = members.slice(i, i + batchSize);
            const results = await Promise.allSettled(
              batch.map((m) =>
                transferMemberRole({
                  serviceSupabase: ctx.serviceSupabase,
                  userId: m.userId,
                  sourceOrgId: m.sourceOrgId,
                  targetOrgId,
                  action: m.action,
                })
              )
            );

            for (let j = 0; j < results.length; j++) {
              const result = results[j];
              const member = batch[j];
              if (result.status === "fulfilled") {
                memberResults.push({
                  orgSlug,
                  userId: member.userId,
                  action: member.action,
                  ok: result.value.ok,
                  error: result.value.ok ? undefined : result.value.error,
                });
              } else {
                memberResults.push({
                  orgSlug,
                  userId: member.userId,
                  action: member.action,
                  ok: false,
                  error: "Unexpected error during transfer",
                });
              }
            }
          }
        }
      }
    }

    // Process email invites — generate invite codes (V1: no email sending)
    const inviteResults: Array<{
      orgSlug: string;
      email: string;
      code: string | null;
      ok: boolean;
      error?: string;
    }> = [];

    if (memberAssignments) {
      for (const assignment of memberAssignments) {
        if (assignment.orgIndex >= organizations.length) continue;
        if (!assignment.emailInvites || assignment.emailInvites.length === 0) continue;

        const orgSlug = organizations[assignment.orgIndex].slug;
        const targetOrgId = slugToOrgId.get(orgSlug);
        if (!targetOrgId) continue;

        for (const invite of assignment.emailInvites) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: inviteData, error: inviteError } = await (ctx.serviceSupabase as any).rpc(
            "create_enterprise_invite",
            {
              p_enterprise_id: ctx.enterpriseId,
              p_organization_id: targetOrgId,
              p_role: invite.role,
              p_uses: 1,
              p_expires_at: null,
            }
          ) as { data: { code: string } | null; error: { message?: string } | null };

          inviteResults.push({
            orgSlug,
            email: invite.email,
            code: inviteData?.code ?? null,
            ok: !inviteError,
            error: inviteError?.message,
          });
        }
      }
    }

    // Audit log per org created
    const requestContext = extractRequestContext(req);
    for (const org of createdOrgs) {
      logEnterpriseAuditAction({
        actorUserId: ctx.userId,
        actorEmail: ctx.userEmail,
        action: "batch_create_sub_org",
        enterpriseId: ctx.enterpriseId,
        targetType: "organization",
        targetId: org.out_org_id!,
        metadata: { slug: org.out_slug, batchSize: organizations.length },
        ...requestContext,
      });
    }

    return respond(
      {
        organizations: rpcResult ?? [],
        memberResults,
        inviteResults,
        summary: {
          orgsCreated: createdOrgs.length,
          orgsFailed: failedOrgs.length,
          membersProcessed: memberResults.length,
          membersFailed: memberResults.filter((r) => !r.ok).length,
          invitesCreated: inviteResults.filter((r) => r.ok).length,
          invitesFailed: inviteResults.filter((r) => !r.ok).length,
        },
      },
      201
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    console.error("[batch-create] Unhandled error:", error);
    return NextResponse.json(
      { error: "Internal server error", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
