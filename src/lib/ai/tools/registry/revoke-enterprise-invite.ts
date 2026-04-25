import { z } from "zod";
import {
  createOrRevisePendingAction,
  type RevokeEnterpriseInvitePendingPayload,
} from "@/lib/ai/pending-actions";
import {
  buildPendingActionField,
  pendingActionFailureToToolError,
} from "@/lib/ai/tools/prepare-tool-helpers";
import { toolError } from "@/lib/ai/tools/result";
import type { ToolModule } from "./types";

const revokeEnterpriseInviteSchema = z
  .object({
    invite_id: z.string().trim().min(1).optional(),
    invite_code: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (typeof value.invite_id === "string" && value.invite_id.length > 0) ||
      (typeof value.invite_code === "string" && value.invite_code.length > 0),
    { message: "Expected invite_id or invite_code" },
  );

type Args = z.infer<typeof revokeEnterpriseInviteSchema>;

export const revokeEnterpriseInviteModule: ToolModule<Args> = {
  name: "revoke_enterprise_invite",
  argsSchema: revokeEnterpriseInviteSchema,
  async execute(args, { ctx, sb }) {
    if (!ctx.threadId) {
      return toolError("Enterprise invite revocation requires a thread context");
    }
    if (!ctx.enterpriseId) {
      return toolError("This assistant does not have enterprise context for this thread.");
    }

    const inviteIdInput = typeof args.invite_id === "string" ? args.invite_id : null;
    const inviteCodeInput = typeof args.invite_code === "string" ? args.invite_code : null;

    let query = sb
      .from("enterprise_invites")
      .select("id, code, role, organization_id, revoked_at")
      .eq("enterprise_id", ctx.enterpriseId);
    if (inviteIdInput) {
      query = query.eq("id", inviteIdInput);
    } else if (inviteCodeInput) {
      query = query.eq("code", inviteCodeInput);
    } else {
      return toolError("Provide invite_id or invite_code to revoke an invite.");
    }

    const { data: invite, error: inviteError } = await query.maybeSingle();
    if (inviteError) {
      return toolError("Failed to look up enterprise invite");
    }
    if (!invite) {
      return toolError("Enterprise invite not found.");
    }
    if (invite.revoked_at) {
      return toolError("This enterprise invite is already revoked.");
    }

    const { data: enterprise, error: entError } = await sb
      .from("enterprises")
      .select("slug")
      .eq("id", ctx.enterpriseId)
      .maybeSingle();
    if (entError || !enterprise?.slug) {
      return toolError("Failed to load enterprise context");
    }

    const pendingPayload: RevokeEnterpriseInvitePendingPayload = {
      enterpriseId: ctx.enterpriseId,
      enterpriseSlug: String(enterprise.slug),
      inviteId: String(invite.id),
      inviteCode: typeof invite.code === "string" ? invite.code : "",
      role: typeof invite.role === "string" ? invite.role : null,
      organizationId: typeof invite.organization_id === "string" ? invite.organization_id : null,
    };

    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "revoke_enterprise_invite",
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
