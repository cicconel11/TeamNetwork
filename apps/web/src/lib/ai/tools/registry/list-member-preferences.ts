/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { isStageTimeoutError } from "@/lib/ai/timeout";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import { getSafeErrorMessage, matchesFilter } from "@/lib/ai/tools/shared";
import { toolError, type ToolExecutionResult } from "@/lib/ai/tools/result";
import type { ToolModule } from "./types";

const listMemberPreferencesSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
    sport: z.string().trim().min(1).max(60).optional(),
    topic: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

type Args = z.infer<typeof listMemberPreferencesSchema>;

interface MentorRow {
  user_id: string;
  sports: string[];
  topics: string[];
  positions: string[];
  industries: string[];
  time_commitment: string | null;
  accepting_new: boolean;
}

interface MenteeRow {
  user_id: string;
  preferred_sports: string[];
  preferred_topics: string[];
  preferred_industries: string[];
  preferred_positions: string[];
  time_availability: string | null;
  seeking_mentorship: boolean;
}

interface AggregatedMember {
  user_id: string;
  name: string;
  email: string | null;
  as_mentor: {
    sports: string[];
    topics: string[];
    positions: string[];
    industries: string[];
    time_commitment: string | null;
    accepting_new: boolean;
  } | null;
  as_mentee: {
    sports: string[];
    topics: string[];
    industries: string[];
    positions: string[];
    time_availability: string | null;
    seeking_mentorship: boolean;
  } | null;
}

export const listMemberPreferencesModule: ToolModule<Args> = {
  name: "list_member_preferences",
  argsSchema: listMemberPreferencesSchema,
  async execute(args, { ctx, sb, logContext, actorRole }) {
    // Non-admins never see member emails — module-level redaction on top of
    // the executor handing them an RLS-bound client.
    return runListMemberPreferences(sb, ctx.orgId, args, logContext, {
      redactEmails: actorRole !== "admin",
    });
  },
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

async function runListMemberPreferences(
  sb: any,
  orgId: string,
  args: Args,
  logContext: AiLogContext,
  options: { redactEmails: boolean },
): Promise<ToolExecutionResult> {
  const limit = Math.min(args.limit ?? 20, 50);

  try {
    const [{ data: mentorRows, error: mentorError }, { data: menteeRows, error: menteeError }] =
      await Promise.all([
        sb
          .from("mentor_profiles")
          .select(
            "user_id, sports, topics, positions, industries, time_commitment, accepting_new, is_active",
          )
          .eq("organization_id", orgId)
          .eq("is_active", true),
        sb
          .from("mentee_preferences")
          .select(
            "user_id, preferred_sports, preferred_topics, preferred_industries, preferred_positions, time_availability, seeking_mentorship",
          )
          .eq("organization_id", orgId),
      ]);

    if (mentorError || menteeError) {
      aiLog("warn", "ai-tools", "list_member_preferences query failed", logContext, {
        error: getSafeErrorMessage(mentorError ?? menteeError),
      });
      return toolError("Query failed");
    }

    const mentorsByUser = new Map<string, MentorRow>();
    for (const row of Array.isArray(mentorRows) ? mentorRows : []) {
      if (typeof row.user_id !== "string") continue;
      mentorsByUser.set(row.user_id, {
        user_id: row.user_id,
        sports: normalizeStringArray(row.sports),
        topics: normalizeStringArray(row.topics),
        positions: normalizeStringArray(row.positions),
        industries: normalizeStringArray(row.industries),
        time_commitment: typeof row.time_commitment === "string" ? row.time_commitment : null,
        accepting_new: Boolean(row.accepting_new),
      });
    }

    const menteesByUser = new Map<string, MenteeRow>();
    for (const row of Array.isArray(menteeRows) ? menteeRows : []) {
      if (typeof row.user_id !== "string") continue;
      menteesByUser.set(row.user_id, {
        user_id: row.user_id,
        preferred_sports: normalizeStringArray(row.preferred_sports),
        preferred_topics: normalizeStringArray(row.preferred_topics),
        preferred_industries: normalizeStringArray(row.preferred_industries),
        preferred_positions: normalizeStringArray(row.preferred_positions),
        time_availability:
          typeof row.time_availability === "string" ? row.time_availability : null,
        seeking_mentorship: Boolean(row.seeking_mentorship),
      });
    }

    const userIds = Array.from(new Set([...mentorsByUser.keys(), ...menteesByUser.keys()]));
    if (userIds.length === 0) {
      return {
        kind: "ok",
        data: { state: "no_results", total: 0, members: [] },
      };
    }

    const { data: userRows, error: userError } = await sb
      .from("users")
      .select("id, name, email")
      .in("id", userIds);

    if (userError) {
      aiLog("warn", "ai-tools", "list_member_preferences user lookup failed", logContext, {
        error: getSafeErrorMessage(userError),
      });
      return toolError("Query failed");
    }

    const userLookup = new Map<string, { name: string | null; email: string | null }>();
    for (const row of Array.isArray(userRows) ? userRows : []) {
      if (typeof row.id !== "string") continue;
      userLookup.set(row.id, {
        name: typeof row.name === "string" ? row.name : null,
        email: typeof row.email === "string" ? row.email : null,
      });
    }

    const aggregated: AggregatedMember[] = [];
    for (const userId of userIds) {
      const mentor = mentorsByUser.get(userId) ?? null;
      const mentee = menteesByUser.get(userId) ?? null;

      const sportsForFilter = [
        ...(mentor?.sports ?? []),
        ...(mentee?.preferred_sports ?? []),
      ];
      const topicsForFilter = [
        ...(mentor?.topics ?? []),
        ...(mentee?.preferred_topics ?? []),
      ];

      if (!matchesFilter(sportsForFilter, args.sport)) continue;
      if (!matchesFilter(topicsForFilter, args.topic)) continue;

      const user = userLookup.get(userId);
      // Redacted actors never see an email anywhere — including the
      // email-as-display-name fallback.
      const emailFallbackName = options.redactEmails ? null : user?.email;
      aggregated.push({
        user_id: userId,
        name: user?.name ?? emailFallbackName ?? "Member",
        email: options.redactEmails ? null : (user?.email ?? null),
        as_mentor: mentor
          ? {
              sports: mentor.sports,
              topics: mentor.topics,
              positions: mentor.positions,
              industries: mentor.industries,
              time_commitment: mentor.time_commitment,
              accepting_new: mentor.accepting_new,
            }
          : null,
        as_mentee: mentee
          ? {
              sports: mentee.preferred_sports,
              topics: mentee.preferred_topics,
              industries: mentee.preferred_industries,
              positions: mentee.preferred_positions,
              time_availability: mentee.time_availability,
              seeking_mentorship: mentee.seeking_mentorship,
            }
          : null,
      });
    }

    aggregated.sort((left, right) => left.name.localeCompare(right.name));
    const members = aggregated.slice(0, limit);

    aiLog("info", "ai-tools", "list_member_preferences completed", logContext, {
      total: aggregated.length,
      returned: members.length,
      sport_filter: args.sport ?? null,
      topic_filter: args.topic ?? null,
    });

    return {
      kind: "ok",
      data: {
        state: members.length === 0 ? "no_results" : "resolved",
        total: aggregated.length,
        members,
      },
    };
  } catch (error) {
    if (isStageTimeoutError(error)) throw error;

    aiLog("warn", "ai-tools", "list_member_preferences failed", logContext, {
      error: getSafeErrorMessage(error),
    });
    return toolError("Unexpected error");
  }
}
