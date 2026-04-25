import { z } from "zod";
import { aiLog } from "@/lib/ai/logger";
import { sanitizeIlikeInput } from "@/lib/security/validation";
import {
  createOrRevisePendingAction,
  type CreateEnterpriseInvitePendingPayload,
} from "@/lib/ai/pending-actions";
import {
  buildPendingActionField,
  pendingActionFailureToToolError,
} from "@/lib/ai/tools/prepare-tool-helpers";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import type { ToolExecutionContext } from "@/lib/ai/tools/executor";
import type { ToolModule } from "./types";

const prepareEnterpriseInviteSchema = z
  .object({
    role: z.enum(["admin", "active_member", "alumni"]).optional(),
    organization_id: z.string().trim().min(1).optional(),
    organization_query: z.string().trim().min(1).optional(),
    uses_remaining: z.number().int().min(1).max(1000).optional(),
    expires_at: z.string().datetime().optional(),
  })
  .strict();

type Args = z.infer<typeof prepareEnterpriseInviteSchema>;

function buildLogContext(
  ctx: Pick<ToolExecutionContext, "orgId" | "userId" | "threadId" | "requestId">,
) {
  return {
    requestId: ctx.requestId ?? "unknown_request",
    orgId: ctx.orgId,
    userId: ctx.userId,
    ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
  };
}

export const prepareEnterpriseInviteModule: ToolModule<Args> = {
  name: "prepare_enterprise_invite",
  argsSchema: prepareEnterpriseInviteSchema,
  async execute(args, { ctx, sb }) {
    const logContext = buildLogContext(ctx);
    if (!ctx.threadId) {
      return toolError("Enterprise invite preparation requires a thread context");
    }
    if (!ctx.enterpriseId) {
      return toolError("This assistant does not have enterprise context for this thread.");
    }

    const missingFields: string[] = [];
    if (!args.role) {
      missingFields.push("role");
    }

    if (args.role === "active_member" && !args.organization_id && !args.organization_query) {
      missingFields.push("organization_id");
    }

    if (missingFields.length > 0) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: missingFields,
          draft: args,
        },
      };
    }

    let organizationId: string | null = args.organization_id ?? null;
    let organizationName: string | null = null;

    if (organizationId) {
      const { data: org, error: orgError } = await sb
        .from("organizations")
        .select("id, name")
        .eq("id", organizationId)
        .eq("enterprise_id", ctx.enterpriseId)
        .maybeSingle();
      if (orgError) {
        aiLog("warn", "ai-tools", "prepare_enterprise_invite org lookup failed", logContext, {
          error: getSafeErrorMessage(orgError),
        });
        return toolError("Failed to resolve managed organization");
      }
      if (!org) {
        return toolError("Managed organization not found for this enterprise.");
      }
      organizationName = typeof org.name === "string" ? org.name : null;
    } else if (args.organization_query) {
      const sanitized = sanitizeIlikeInput(args.organization_query);
      const { data: orgs, error: orgError } = await sb
        .from("organizations")
        .select("id, name, slug")
        .eq("enterprise_id", ctx.enterpriseId)
        .or(`name.ilike.%${sanitized}%,slug.ilike.%${sanitized}%`)
        .limit(2);
      if (orgError) {
        return toolError("Failed to search managed organizations");
      }
      const rows = Array.isArray(orgs) ? orgs : [];
      if (rows.length === 0) {
        return toolError("No managed organization matched that name or slug.");
      }
      if (rows.length > 1) {
        return {
          kind: "ok",
          data: {
            state: "missing_fields",
            missing_fields: ["organization_id"],
            draft: args,
            candidates: rows.map((row: { id: string; name: string; slug: string }) => ({
              id: row.id,
              name: row.name,
              slug: row.slug,
            })),
          },
        };
      }
      organizationId = rows[0].id as string;
      organizationName = rows[0].name as string;
    }

    const { data: enterprise, error: entError } = await sb
      .from("enterprises")
      .select("slug")
      .eq("id", ctx.enterpriseId)
      .maybeSingle();
    if (entError || !enterprise?.slug) {
      return toolError("Failed to load enterprise context");
    }

    const pendingPayload: CreateEnterpriseInvitePendingPayload = {
      enterpriseId: ctx.enterpriseId,
      enterpriseSlug: String(enterprise.slug),
      role: args.role as "admin" | "active_member" | "alumni",
      organizationId,
      organizationName,
      usesRemaining: args.uses_remaining ?? null,
      expiresAt: args.expires_at ?? null,
    };

    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "create_enterprise_invite",
      payload: pendingPayload,
      activeActionId: ctx.activePendingActionId,
    });
    if ("failed" in created) return pendingActionFailureToToolError(created.reason);
    return {
      kind: "ok",
      data: {
        state: "needs_confirmation",
        draft: pendingPayload,
        pending_action: buildPendingActionField(created, pendingPayload),
      },
    };
  },
};
