import { z } from "zod";
import { aiLog } from "@/lib/ai/logger";
import {
  listAllOrgChatGroups,
  listUserChatGroups,
  type GroupChatSupabase,
} from "@/lib/chat/group-chat";
import { toolError } from "@/lib/ai/tools/result";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import type { ToolModule } from "./types";

const listChatGroupsSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
    scope: z.enum(["mine", "all"]).optional(),
  })
  .strict();

type Args = z.infer<typeof listChatGroupsSchema>;

export const listChatGroupsModule: ToolModule<Args> = {
  name: "list_chat_groups",
  argsSchema: listChatGroupsSchema,
  async execute(args, { ctx, sb, logContext }) {
    const limit = Math.min(args.limit ?? 25, 50);
    const scope = args.scope ?? "mine";

    const role =
      ctx.authorization.kind === "preverified_role"
        ? ctx.authorization.role
        : "admin";

    if (scope === "all" && role !== "admin") {
      return toolError(
        "Admin role required to list every chat group in the org."
      );
    }

    if (scope === "all") {
      const { data, error } = await listAllOrgChatGroups(sb as GroupChatSupabase, {
        organizationId: ctx.orgId,
        userId: ctx.userId,
        limit,
      });

      if (error) {
        aiLog("warn", "ai-tools", "list_chat_groups (all) failed", logContext, {
          error: getSafeErrorMessage(error),
        });
        return toolError("Failed to load chat groups");
      }

      return {
        kind: "ok",
        data: (data ?? []).map((group) => ({
          id: group.id,
          name: group.name,
          description: group.description,
          updated_at: group.updated_at,
          member_count: group.member_count,
          is_member: group.is_member,
          role: group.role,
        })),
      };
    }

    const { data, error } = await listUserChatGroups(sb as GroupChatSupabase, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      limit,
    });

    if (error) {
      aiLog("warn", "ai-tools", "list_chat_groups failed", logContext, {
        error: getSafeErrorMessage(error),
      });
      return toolError("Failed to load chat groups");
    }

    return {
      kind: "ok",
      data: (data ?? []).map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        role: group.role,
        updated_at: group.updated_at,
      })),
    };
  },
};
