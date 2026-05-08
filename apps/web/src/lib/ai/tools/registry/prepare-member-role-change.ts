import { z } from "zod";
import { createOrRevisePendingAction, type MemberRoleChangePendingPayload } from "@/lib/ai/pending-actions";
import { prepareMemberRoleChangeSchema } from "@/lib/ai/tools/prepare-schemas";
import {
  buildPendingActionField,
  pendingActionFailureToToolError,
  sanitizeDraftValue,
} from "@/lib/ai/tools/prepare-tool-helpers";
import { toolError } from "@/lib/ai/tools/result";
import {
  prepareMemberRoleChange,
  resolveMemberRoleChangeTarget,
  type MemberRoleChangeClient,
} from "@/lib/members/role-change";
import type { ToolModule } from "./types";

type Args = z.infer<typeof prepareMemberRoleChangeSchema>;

export const prepareMemberRoleChangeModule: ToolModule<Args> = {
  name: "prepare_member_role_change",
  argsSchema: prepareMemberRoleChangeSchema,
  async execute(args, { ctx, sb }) {
    if (!ctx.threadId) {
      return toolError("Member role changes require a thread context");
    }

    const normalizedDraft = {
      ...Object.fromEntries(
        Object.entries({
          target_member_id: args.target_member_id,
          target_user_id: args.target_user_id,
          person_query: sanitizeDraftValue(args.person_query),
          role: args.role,
          status: args.status,
          reason: sanitizeDraftValue(args.reason),
        }).filter(([, value]) => value !== undefined)
      ),
    };

    const parsedDraft = prepareMemberRoleChangeSchema.safeParse(normalizedDraft);
    if (!parsedDraft.success) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: parsedDraft.error.issues.map((issue) => issue.path.join(".") || "role"),
          draft: normalizedDraft,
        },
      };
    }

    const target = await resolveMemberRoleChangeTarget(sb as MemberRoleChangeClient, {
      organizationId: ctx.orgId,
      targetMemberId: parsedDraft.data.target_member_id,
      targetUserId: parsedDraft.data.target_user_id,
      personQuery: parsedDraft.data.person_query,
    });

    if (target.state === "missing_target") {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: ["person_query"],
          clarification_kind: "target_required",
          draft: parsedDraft.data,
        },
      };
    }

    if (target.state === "ambiguous") {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          missing_fields: ["person_query"],
          clarification_kind: "target_ambiguous",
          requested_target: target.requestedTarget,
          candidate_targets: target.candidates,
          draft: parsedDraft.data,
        },
      };
    }

    if (target.state === "target_not_found" || target.state === "target_unlinked") {
      return {
        kind: "ok",
        data: {
          state: "invalid",
          reason: target.state === "target_not_found" ? "target_not_found" : "target_unlinked",
          requested_target: target.requestedTarget,
          draft: parsedDraft.data,
        },
      };
    }

    if (target.state === "error") {
      return toolError(target.message);
    }

    const prepared = await prepareMemberRoleChange(sb as MemberRoleChangeClient, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      targetUserId: target.userId,
      role: parsedDraft.data.role,
      status: parsedDraft.data.status,
      reason: parsedDraft.data.reason,
    });

    if (prepared.state === "invalid") {
      return {
        kind: "ok",
        data: {
          state: "invalid",
          reason: prepared.reason,
          draft: {
            ...parsedDraft.data,
            target_member_id: target.memberId,
            target_user_id: target.userId,
          },
        },
      };
    }

    if (prepared.state === "error") {
      return toolError(prepared.message);
    }

    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("slug")
      .eq("id", ctx.orgId)
      .maybeSingle();

    if (orgError) {
      return toolError("Failed to load organization context");
    }

    const pendingPayload: MemberRoleChangePendingPayload = {
      orgSlug: typeof org?.slug === "string" ? org.slug : null,
      target_member_id: target.memberId,
      target_user_id: target.userId,
      target_display_name: target.displayName,
      target_email: target.email,
      current_role: prepared.currentRole,
      new_role: prepared.nextRole,
      current_status: prepared.currentStatus,
      new_status: prepared.nextStatus,
      role_changed: prepared.roleChanged,
      status_changed: prepared.statusChanged,
      reason: parsedDraft.data.reason ?? null,
    };

    const created = await createOrRevisePendingAction(sb, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: ctx.threadId,
      actionType: "member_role_change",
      payload: pendingPayload,
      activeActionId: ctx.activePendingActionId,
    });
    if ("failed" in created) return pendingActionFailureToToolError(created.reason);

    return {
      kind: "ok",
      data: {
        state: "needs_confirmation",
        draft: {
          ...parsedDraft.data,
          target_member_id: target.memberId,
          target_user_id: target.userId,
        },
        pending_action: buildPendingActionField(created, pendingPayload),
      },
    };
  },
};
