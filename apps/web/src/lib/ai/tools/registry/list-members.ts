import { z } from "zod";
import {
  buildMemberName,
  isPlaceholderMemberName,
  isTrustworthyHumanName,
  safeToolQuery,
  type MemberToolRow,
  type UserNameRow,
} from "@/lib/ai/tools/shared";
import type { ToolModule } from "./types";

const listMembersSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

type Args = z.infer<typeof listMembersSchema>;

export const listMembersModule: ToolModule<Args> = {
  name: "list_members",
  argsSchema: listMembersSchema,
  async execute(args, { ctx, sb, logContext }) {
    const limit = Math.min(args.limit ?? 20, 50);
    return safeToolQuery(logContext, async () => {
      const { data, error } = await sb
        .from("members")
        .select("id, user_id, status, role, created_at, first_name, last_name, email")
        .eq("organization_id", ctx.orgId)
        .is("deleted_at", null)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!Array.isArray(data) || error) {
        return { data, error };
      }

      const members = data as MemberToolRow[];
      const linkedUserIds = [
        ...new Set(
          members
            .map((member) => member.user_id)
            .filter((userId): userId is string => typeof userId === "string" && userId.length > 0)
        ),
      ];

      const userNameById = new Map<string, string>();

      if (linkedUserIds.length > 0) {
        const { data: userRows, error: userError } = await sb
          .from("users")
          .select("id, name")
          .in("id", linkedUserIds);

        if (userError) {
          return { data: null, error: userError };
        }

        if (Array.isArray(userRows)) {
          for (const user of userRows as UserNameRow[]) {
            if (isTrustworthyHumanName(user.name)) {
              userNameById.set(user.id, user.name.trim());
            }
          }
        }
      }

      return {
        data: members.map((member) => {
          const memberName = buildMemberName(member.first_name, member.last_name);
          const fallbackUserName =
            member.user_id && !isPlaceholderMemberName(member.first_name, member.last_name)
              ? null
              : member.user_id
                ? userNameById.get(member.user_id) ?? null
                : null;

          return {
            id: member.id,
            user_id: member.user_id,
            status: member.status,
            role: member.role,
            created_at: member.created_at,
            name:
              memberName && !isPlaceholderMemberName(member.first_name, member.last_name)
                ? memberName
                : fallbackUserName ?? "",
            email: member.email,
          };
        }),
        error,
      };
    });
  },
};
