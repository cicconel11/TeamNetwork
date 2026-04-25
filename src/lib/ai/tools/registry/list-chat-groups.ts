import { z } from "zod";
import { aiLog } from "@/lib/ai/logger";
import { listUserChatGroups, type GroupChatSupabase } from "@/lib/chat/group-chat";
import { toolError } from "@/lib/ai/tools/executor";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import type { ToolModule } from "./types";

const listChatGroupsSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

type Args = z.infer<typeof listChatGroupsSchema>;

export const listChatGroupsModule: ToolModule<Args> = {
  name: "list_chat_groups",
  argsSchema: listChatGroupsSchema,
  async execute(args, { ctx, sb, logContext }) {
    const limit = Math.min(args.limit ?? 25, 50);
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
