import { z } from "zod";
import { sanitizeIlikeInput } from "@/lib/security/validation";
import {
  buildMemberName,
  isPlaceholderMemberName,
  isTrustworthyHumanName,
  MEMBER_LEAN_DEFAULT_FIELDS,
  MEMBER_OUTPUT_FIELDS,
  projectFields,
  safeToolQuery,
  truncateBody,
  type MemberToolRow,
  type UserNameRow,
} from "@/lib/ai/tools/shared";
import type { ToolModule } from "./types";

const listMembersSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
    company: z.string().trim().min(1).optional(),
    industry: z.string().trim().min(1).optional(),
    // Substring match within the enriched jsonb arrays.
    skill: z.string().trim().min(1).optional(),
    certification: z.string().trim().min(1).optional(),
    language: z.string().trim().min(1).optional(),
    // Defaults to id/name/role/email. Request heavy LinkedIn fields
    // (summary/headline/skills/certifications/languages) explicitly.
    fields: z.array(z.enum(MEMBER_OUTPUT_FIELDS)).min(1).optional(),
  })
  .strict();

type Args = z.infer<typeof listMembersSchema>;

export const listMembersModule: ToolModule<Args> = {
  name: "list_members",
  argsSchema: listMembersSchema,
  async execute(args, { ctx, sb, logContext }) {
    const limit = Math.min(args.limit ?? 20, 50);
    const selectedFields = args.fields ?? MEMBER_LEAN_DEFAULT_FIELDS;
    return safeToolQuery(logContext, async () => {
      let query = sb
        .from("members")
        .select(
          "id, user_id, status, role, created_at, first_name, last_name, email, current_company, industry, headline, summary, skills, certifications, languages"
        )
        .eq("organization_id", ctx.orgId)
        .is("deleted_at", null)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (args.company) {
        query = query.ilike("current_company", `%${sanitizeIlikeInput(args.company)}%`);
      }
      if (args.industry) {
        query = query.ilike("industry", `%${sanitizeIlikeInput(args.industry)}%`);
      }
      if (args.skill) {
        query = query.ilike("skills::text", `%${sanitizeIlikeInput(args.skill)}%`);
      }
      if (args.certification) {
        query = query.ilike("certifications::text", `%${sanitizeIlikeInput(args.certification)}%`);
      }
      if (args.language) {
        query = query.ilike("languages::text", `%${sanitizeIlikeInput(args.language)}%`);
      }

      const { data, error } = await query;

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

          // Build the full role-correct row first, then narrow to the
          // requested fields. Projection only ever removes keys, so a field the
          // model didn't ask for never reaches the context. Heavy free-text
          // fields are truncated so an opt-in request stays bounded.
          const fullRow = {
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
            current_company: member.current_company ?? null,
            industry: member.industry ?? null,
            headline: truncateBody(member.headline),
            summary: truncateBody(member.summary),
            skills: member.skills ?? null,
            certifications: member.certifications ?? null,
            languages: member.languages ?? null,
          };
          return projectFields(fullRow, selectedFields);
        }),
        error,
      };
    });
  },
};
