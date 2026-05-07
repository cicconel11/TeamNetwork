/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { isStageTimeoutError } from "@/lib/ai/timeout";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError, type ToolExecutionResult } from "@/lib/ai/tools/result";
import type { ToolModule } from "./types";

const listAvailableMentorsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
  })
  .strict();

type Args = z.infer<typeof listAvailableMentorsSchema>;

export const listAvailableMentorsModule: ToolModule<Args> = {
  name: "list_available_mentors",
  argsSchema: listAvailableMentorsSchema,
  async execute(args, { ctx, sb, logContext }) {
    return runListAvailableMentors(sb, ctx.orgId, args, logContext);
  },
};

async function runListAvailableMentors(
  sb: any,
  orgId: string,
  args: Args,
  logContext: AiLogContext,
): Promise<ToolExecutionResult> {
  const limit = args.limit ?? 5;

  try {
    const { data: mentorProfiles, error } = await sb
      .from("mentor_profiles")
      .select(
        "user_id, topics, sports, positions, max_mentees, current_mentee_count, accepting_new, is_active",
      )
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .eq("accepting_new", true);

    if (error) {
      aiLog("warn", "ai-tools", "list_available_mentors query failed", logContext, {
        error: getSafeErrorMessage(error),
      });
      return toolError("Query failed");
    }

    const eligibleMentors = (Array.isArray(mentorProfiles) ? mentorProfiles : [])
      .map((profile: Record<string, unknown>) => ({
        user_id: typeof profile.user_id === "string" ? profile.user_id : null,
        topics: Array.isArray(profile.topics)
          ? profile.topics.filter((value: unknown): value is string => typeof value === "string")
          : [],
        sports: Array.isArray(profile.sports)
          ? profile.sports.filter((value: unknown): value is string => typeof value === "string")
          : [],
        positions: Array.isArray(profile.positions)
          ? profile.positions.filter((value: unknown): value is string => typeof value === "string")
          : [],
        max_mentees: typeof profile.max_mentees === "number" ? profile.max_mentees : 3,
        current_mentee_count:
          typeof profile.current_mentee_count === "number" ? profile.current_mentee_count : 0,
      }))
      .filter(
        (
          profile,
        ): profile is {
          user_id: string;
          topics: string[];
          sports: string[];
          positions: string[];
          max_mentees: number;
          current_mentee_count: number;
        } =>
          Boolean(profile.user_id) && profile.max_mentees > profile.current_mentee_count,
      );

    if (eligibleMentors.length === 0) {
      return {
        kind: "ok",
        data: { state: "no_results", total_available: 0, mentors: [] },
      };
    }

    const mentorUserIds = eligibleMentors.map((mentor) => mentor.user_id);
    const [{ data: mentorUsers, error: usersError }, { data: alumniRows, error: alumniError }] =
      await Promise.all([
        sb.from("users").select("id, name, email").in("id", mentorUserIds),
        sb
          .from("alumni")
          .select("user_id, job_title, current_company")
          .eq("organization_id", orgId)
          .in("user_id", mentorUserIds),
      ]);

    if (usersError || alumniError) {
      aiLog("warn", "ai-tools", "list_available_mentors enrichment failed", logContext, {
        error: getSafeErrorMessage(usersError ?? alumniError),
      });
      return toolError("Query failed");
    }

    const userLookup = new Map<string, { name: string | null; email: string | null }>();
    for (const row of Array.isArray(mentorUsers) ? mentorUsers : []) {
      if (typeof row.id !== "string") continue;
      userLookup.set(row.id, {
        name: typeof row.name === "string" ? row.name : null,
        email: typeof row.email === "string" ? row.email : null,
      });
    }

    const alumniLookup = new Map<
      string,
      { job_title: string | null; current_company: string | null }
    >();
    for (const row of Array.isArray(alumniRows) ? alumniRows : []) {
      if (typeof row.user_id !== "string") continue;
      alumniLookup.set(row.user_id, {
        job_title: typeof row.job_title === "string" ? row.job_title : null,
        current_company:
          typeof row.current_company === "string" ? row.current_company : null,
      });
    }

    const mentors = eligibleMentors
      .sort((left, right) => {
        const leftOpenSlots = left.max_mentees - left.current_mentee_count;
        const rightOpenSlots = right.max_mentees - right.current_mentee_count;
        if (rightOpenSlots !== leftOpenSlots) return rightOpenSlots - leftOpenSlots;
        return left.current_mentee_count - right.current_mentee_count;
      })
      .slice(0, limit)
      .map((mentor) => {
        const user = userLookup.get(mentor.user_id);
        const alumni = alumniLookup.get(mentor.user_id);
        const subtitle = [alumni?.job_title, alumni?.current_company]
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .join(" at ");

        return {
          mentor: {
            user_id: mentor.user_id,
            name: user?.name ?? user?.email ?? "Mentor",
            subtitle: subtitle || null,
          },
          open_slots: mentor.max_mentees - mentor.current_mentee_count,
          current_mentee_count: mentor.current_mentee_count,
          max_mentees: mentor.max_mentees,
          topics: mentor.topics.slice(0, 3),
          sports: mentor.sports.slice(0, 3),
          positions: mentor.positions.slice(0, 3),
        };
      });

    aiLog("info", "ai-tools", "list_available_mentors completed", logContext, {
      total_available: eligibleMentors.length,
      returned_count: mentors.length,
    });

    return {
      kind: "ok",
      data: {
        state: "resolved",
        total_available: eligibleMentors.length,
        mentors,
      },
    };
  } catch (error) {
    if (isStageTimeoutError(error)) throw error;

    aiLog("warn", "ai-tools", "list_available_mentors failed", logContext, {
      error: getSafeErrorMessage(error),
    });
    return toolError("Unexpected error");
  }
}
