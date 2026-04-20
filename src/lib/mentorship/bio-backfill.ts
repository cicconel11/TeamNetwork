import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  computeBioInputHash,
  generateMentorBio,
  type BioGenerationInput,
} from "@/lib/mentorship/bio-generator";
import { resolveMentorshipConfig, type CustomAttributeDef } from "@/lib/mentorship/matching-weights";
import { canonicalizeIndustry, canonicalizeRoleFamily } from "@/lib/falkordb/career-signals";

export interface MentorBioBackfillCandidate {
  mentorProfileId: string | null;
  organizationId: string;
  userId: string;
  bio: string | null;
  bioSource: "manual" | "ai_generated" | null;
  bioGeneratedAt: string | null;
  bioInputHash: string | null;
  nextInputHash: string;
}

export interface LoadedMentorBioContext extends MentorBioBackfillCandidate {
  input: BioGenerationInput;
}

export interface MentorBioQueueStats {
  processed: number;
  skipped: number;
  failed: number;
}

interface QueueItem {
  id: string;
  organization_id: string;
  mentor_profile_id: string;
}

interface MentorProfileRow {
  id: string;
  organization_id: string;
  user_id: string;
  bio: string | null;
  bio_source: "manual" | "ai_generated" | null;
  bio_generated_at: string | null;
  bio_input_hash: string | null;
  custom_attributes: Record<string, unknown> | null;
}

interface AlumniRow {
  headline: string | null;
  summary: string | null;
  job_title: string | null;
  position_title: string | null;
  current_company: string | null;
  industry: string | null;
  graduation_year: number | null;
}

const MAX_ERROR_LENGTH = 500;

type QueryClient = SupabaseClient<Database> & {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => unknown;
      maybeSingle?: () => Promise<{ data: Record<string, unknown> | null; error?: { message: string } | null }>;
    };
    update?: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => {
        or: (filters: string) => Promise<{ data?: unknown; error: { message: string } | null }>;
      };
    };
  };
  rpc: (
    fn: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export function extractBioCustomAttributes(
  defs: readonly CustomAttributeDef[],
  rawCustomAttributes: Record<string, unknown> | null | undefined
): Record<string, string> | null {
  if (!rawCustomAttributes) return null;

  const extracted: Record<string, string> = {};

  for (const def of defs) {
    if (def.type === "text") continue;

    const rawValue = rawCustomAttributes[def.key];
    if (typeof rawValue === "string") {
      const trimmed = rawValue.trim();
      if (trimmed) extracted[def.key] = trimmed;
      continue;
    }

    if (Array.isArray(rawValue)) {
      const joined = rawValue
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
        .join(", ");

      if (joined) extracted[def.key] = joined;
    }
  }

  return Object.keys(extracted).length > 0 ? extracted : null;
}

export function shouldEnqueueMentorBioBackfill(
  candidate: MentorBioBackfillCandidate
): boolean {
  if (candidate.bioSource === "manual") return false;
  if (!candidate.bio?.trim()) return true;
  if (candidate.bioSource !== "ai_generated") return false;
  if (!candidate.bioGeneratedAt) return true;
  return candidate.bioInputHash !== candidate.nextInputHash;
}

export function shouldPersistGeneratedBio(
  candidate: MentorBioBackfillCandidate
): boolean {
  return shouldEnqueueMentorBioBackfill(candidate);
}

export async function loadMentorBioContext(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  userId: string
): Promise<LoadedMentorBioContext | null> {
  const client = supabase as unknown as QueryClient;

  const queryMaybeSingle = (
    table: string,
    columns: string,
    filters: Array<[string, string]>
  ) => {
    let query = client.from(table).select(columns) as unknown as {
      eq: (column: string, value: string) => typeof query;
      maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error?: { message: string } | null }>;
    };

    for (const [column, value] of filters) {
      query = query.eq(column, value);
    }

    return query.maybeSingle();
  };

  const [alumniResult, orgResult, userResult, mentorProfileResult] = await Promise.all([
    queryMaybeSingle(
      "alumni",
      "headline, summary, job_title, position_title, current_company, industry, graduation_year",
      [["user_id", userId], ["organization_id", organizationId]]
    ),
    queryMaybeSingle("organizations", "settings, name", [["id", organizationId]]),
    queryMaybeSingle(
      "user_organization_roles",
      "user_id, users(name)",
      [["user_id", userId], ["organization_id", organizationId]]
    ),
    queryMaybeSingle(
      "mentor_profiles",
      "id, organization_id, user_id, bio, bio_source, bio_generated_at, bio_input_hash, custom_attributes",
      [["user_id", userId], ["organization_id", organizationId]]
    ),
  ]);
  const mentorProfile = mentorProfileResult.data as MentorProfileRow | null;

  const alumni = alumniResult.data as AlumniRow | null;
  const orgRow = orgResult.data as { settings?: unknown; name?: string | null } | null;
  const userName = (
    userResult.data as { users?: { name?: string | null } | Array<{ name?: string | null }> | null } | null
  )?.users;

  const resolvedUserName = Array.isArray(userName)
    ? userName[0]?.name ?? "Member"
    : userName?.name ?? "Member";

  const config = resolveMentorshipConfig(orgRow?.settings);
  const customAttributes = extractBioCustomAttributes(
    config.customAttributeDefs,
    mentorProfile?.custom_attributes
  );

  const rawJobTitle = alumni?.job_title ?? alumni?.position_title ?? null;
  const rawCompany = alumni?.current_company ?? null;
  const industry = canonicalizeIndustry(alumni?.industry ?? null);
  const roleFamily = canonicalizeRoleFamily(rawJobTitle, rawCompany, industry);

  const input: BioGenerationInput = {
    name: resolvedUserName,
    jobTitle: rawJobTitle,
    currentCompany: rawCompany,
    industry,
    roleFamily,
    graduationYear: alumni?.graduation_year ?? null,
    linkedinSummary: alumni?.summary ?? null,
    linkedinHeadline: alumni?.headline ?? null,
    customAttributes,
    orgName: orgRow?.name ?? "",
  };

  return {
    mentorProfileId: mentorProfile?.id ?? null,
    organizationId,
    userId,
    bio: mentorProfile?.bio ?? null,
    bioSource: mentorProfile?.bio_source ?? null,
    bioGeneratedAt: mentorProfile?.bio_generated_at ?? null,
    bioInputHash: mentorProfile?.bio_input_hash ?? null,
    nextInputHash: computeBioInputHash(input),
    input,
  };
}

async function incrementMentorBioBackfillAttempts(
  supabase: SupabaseClient<Database>,
  queueId: string,
  errorMessage: string
) {
  const client = supabase as unknown as QueryClient;
  const { error } = await client.rpc("increment_mentor_bio_backfill_attempts", {
    p_id: queueId,
    p_error: errorMessage.slice(0, MAX_ERROR_LENGTH),
  });

  if (error) {
    console.error("[mentor-bio-backfill] increment attempts RPC failed:", error);
  }
}

async function persistGeneratedMentorBio(
  supabase: SupabaseClient<Database>,
  context: LoadedMentorBioContext,
  bio: string,
  inputHash: string
) {
  if (!context.mentorProfileId) {
    throw new Error("Cannot persist a generated bio without a mentor profile id");
  }

  const client = supabase as unknown as QueryClient;
  const { error } =
    await client
      .from("mentor_profiles")
      .update?.({
        bio,
        bio_source: "ai_generated",
        bio_generated_at: new Date().toISOString(),
        bio_input_hash: inputHash,
      })
      .eq("id", context.mentorProfileId)
      .or("bio_source.is.null,bio_source.neq.manual");

  if (error) {
    throw new Error(`Failed to persist generated mentor bio: ${error.message}`);
  }
}

export async function processMentorBioBackfillQueue(
  supabase: SupabaseClient<Database>,
  options?: { batchSize?: number }
): Promise<MentorBioQueueStats> {
  const client = supabase as unknown as QueryClient;
  const batchSize = options?.batchSize ?? 25;
  const stats: MentorBioQueueStats = { processed: 0, skipped: 0, failed: 0 };

  const { data, error } = await client.rpc(
    "dequeue_mentor_bio_backfill_queue",
    { p_batch_size: batchSize }
  );

  if (error || !Array.isArray(data) || data.length === 0) {
    if (error) {
      console.error("[mentor-bio-backfill] dequeue failed:", error);
    }
    return stats;
  }

  const queueItems = data as QueueItem[];

  for (const item of queueItems) {
    try {
      const profileRowResult =
        await client
          .from("mentor_profiles")
          .select("id, user_id, organization_id")
          .eq("id", item.mentor_profile_id)
          .maybeSingle?.();

      const profileRow = profileRowResult?.data as
        | { id: string; user_id: string; organization_id: string }
        | null;

      if (!profileRow) {
        stats.skipped++;
        continue;
      }

      const context = await loadMentorBioContext(
        supabase,
        profileRow.organization_id,
        profileRow.user_id
      );

      if (!context || !shouldPersistGeneratedBio(context)) {
        stats.skipped++;
        continue;
      }

      const result = await generateMentorBio(context.input);
      await persistGeneratedMentorBio(
        supabase,
        context,
        result.bio,
        result.inputHash
      );
      stats.processed++;
    } catch (err) {
      stats.failed++;
      const message = err instanceof Error ? err.message : "Unknown mentor bio backfill error";
      await incrementMentorBioBackfillAttempts(supabase, item.id, message);
    }
  }

  return stats;
}
