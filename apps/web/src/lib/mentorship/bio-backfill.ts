import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  computeBioInputHash,
  generateMentorBio,
  type BioGenerationInput,
  type BioGenerationResult,
} from "@/lib/mentorship/bio-generator";
import { resolveMentorshipConfig, type CustomAttributeDef } from "@/lib/mentorship/matching-weights";
import { canonicalizeIndustry, canonicalizeRoleFamily } from "@/lib/people-graph/career-signals";
import { resolveEnrichedProfiles } from "@/lib/profile/enriched-fields";

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
  expertise_areas: string[] | null;
  topics: string[] | null;
  sports: string[] | null;
  positions: string[] | null;
}

/** LinkedIn free-text only. Enriched structured fields come from
 * {@link resolveEnrichedProfiles} so members-first precedence is honored. */
interface AlumniTextRow {
  headline: string | null;
  summary: string | null;
}

const MAX_ERROR_LENGTH = 500;

type QueryClient = SupabaseClient<Database> & {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => unknown;
      maybeSingle?: () => Promise<{ data: Record<string, unknown> | null; error?: { message: string } | null }>;
    };
    update?: (values: Record<string, unknown>) => {
      eq: (
        column: string,
        value: string
      ) => Promise<{ data?: unknown; error: { message: string } | null }> & {
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
    filters: Array<[string, string]>,
    isNullColumns: string[] = []
  ) => {
    let query = client.from(table).select(columns) as unknown as {
      eq: (column: string, value: string) => typeof query;
      is: (column: string, value: null) => typeof query;
      maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error?: { message: string } | null }>;
    };

    for (const [column, value] of filters) {
      query = query.eq(column, value);
    }
    for (const column of isNullColumns) {
      query = query.is(column, null);
    }

    return query.maybeSingle();
  };

  // Enriched structured fields (company/industry/job_title/grad year) follow
  // members-first precedence and soft-delete filtering via resolveEnrichedProfiles.
  // alumni is read ONLY for LinkedIn free text, filtered to non-deleted rows.
  const [alumniTextResult, orgResult, userResult, mentorProfileResult, enrichedByUser] =
    await Promise.all([
      queryMaybeSingle(
        "alumni",
        "headline, summary",
        [["user_id", userId], ["organization_id", organizationId]],
        ["deleted_at"]
      ),
      queryMaybeSingle("organizations", "settings, name", [["id", organizationId]]),
      queryMaybeSingle(
        "user_organization_roles",
        "user_id, users(name)",
        [["user_id", userId], ["organization_id", organizationId]]
      ),
      queryMaybeSingle(
        "mentor_profiles",
        "id, organization_id, user_id, bio, bio_source, bio_generated_at, bio_input_hash, custom_attributes, expertise_areas, topics, sports, positions",
        [["user_id", userId], ["organization_id", organizationId]]
      ),
      resolveEnrichedProfiles(supabase, organizationId, [userId]),
    ]);
  const mentorProfile = mentorProfileResult.data as MentorProfileRow | null;

  const alumniText = alumniTextResult.data as AlumniTextRow | null;
  const enriched = enrichedByUser.get(userId) ?? null;
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

  const rawJobTitle = enriched?.job_title ?? enriched?.position_title ?? null;
  const rawCompany = enriched?.current_company ?? null;
  const industry = canonicalizeIndustry(enriched?.industry ?? null);
  const roleFamily = canonicalizeRoleFamily(rawJobTitle, rawCompany, industry);

  const nonEmptyArray = (value: string[] | null | undefined): string[] | null =>
    value && value.length > 0 ? value : null;

  const input: BioGenerationInput = {
    name: resolvedUserName,
    jobTitle: rawJobTitle,
    currentCompany: rawCompany,
    industry,
    roleFamily,
    graduationYear: enriched?.graduation_year ?? null,
    linkedinSummary: alumniText?.summary ?? null,
    linkedinHeadline: alumniText?.headline ?? null,
    customAttributes,
    chosenExpertiseAreas: nonEmptyArray(mentorProfile?.expertise_areas),
    chosenTopics: nonEmptyArray(mentorProfile?.topics),
    chosenSports: nonEmptyArray(mentorProfile?.sports),
    chosenPositions: nonEmptyArray(mentorProfile?.positions),
    orgName: orgRow?.name ?? "",
    orgId: organizationId,
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
  inputHash: string,
  allowManualOverwrite = false
) {
  if (!context.mentorProfileId) {
    throw new Error("Cannot persist a generated bio without a mentor profile id");
  }

  const client = supabase as unknown as QueryClient;
  const updateChain = client
    .from("mentor_profiles")
    .update?.({
      bio,
      bio_source: "ai_generated",
      bio_generated_at: new Date().toISOString(),
      bio_input_hash: inputHash,
    })
    .eq("id", context.mentorProfileId);

  if (!updateChain) {
    throw new Error("Failed to persist generated mentor bio: update unavailable");
  }

  // Background backfill never clobbers a manual bio; explicit regeneration may.
  // When overwrite is allowed we await the `.eq("id", …)` filter directly,
  // dropping the manual-source guard.
  const { error } = allowManualOverwrite
    ? await updateChain
    : await updateChain.or("bio_source.is.null,bio_source.neq.manual");

  if (error) {
    throw new Error(`Failed to persist generated mentor bio: ${error.message}`);
  }
}

export interface RegenerateMentorBioResult {
  bio: string;
  model: string;
  bioSource: "ai_generated";
  topics: string[];
  expertiseAreas: string[];
  inputHash: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/**
 * Explicit, user-triggered bio regeneration for a single mentor.
 *
 * Loads the latest profile context, generates a fresh bio, and persists it.
 * Returns `null` when the user has no mentor_profiles row (the caller should
 * surface 404/409) — we never create a profile here. When
 * `allowManualOverwrite` is true the persist drops the manual-source guard, so
 * a manually written bio is replaced. If grounding rejects the generated bio,
 * the template is persisted with model `"template_grounding_rejected"` and that
 * model is returned to the caller.
 */
export async function regenerateMentorBio(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  userId: string,
  opts: { allowManualOverwrite: boolean; spendBypass?: boolean }
): Promise<RegenerateMentorBioResult | null> {
  const context = await loadMentorBioContext(supabase, organizationId, userId);
  if (!context || !context.mentorProfileId) {
    return null;
  }

  const result: BioGenerationResult = await generateMentorBio({
    ...context.input,
    spendBypass: opts.spendBypass,
  });

  await persistGeneratedMentorBio(
    supabase,
    context,
    result.bio,
    result.inputHash,
    opts.allowManualOverwrite
  );

  return {
    bio: result.bio,
    model: result.model,
    bioSource: "ai_generated",
    topics: result.topics,
    expertiseAreas: result.expertiseAreas,
    inputHash: result.inputHash,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
  };
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
