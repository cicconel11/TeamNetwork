import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ALUMNI_PERSON_SELECT,
  buildProjectedPeople,
  buildSourcePerson,
  MEMBER_PERSON_SELECT,
  PARENT_PERSON_SELECT,
  type AlumniPersonRow,
  type MemberPersonRow,
  type ParentPersonRow,
  type ProjectedPerson,
} from "@/lib/people-graph/people";
import {
  buildConnectionRarityStats,
  getCandidateQualificationCodes,
  hasProfessionalStrengthQualification,
  hasProfessionalStrengthReason,
  inspectCandidateSignals,
  buildDisplayReadyConnectionPerson,
  buildDisplayReadySuggestedConnection,
  buildSuggestionForCandidate,
  clampSuggestionsLimit,
  normalizeConnectionText,
  sortSuggestedConnections,
  type CandidateQualificationCode,
  type ConnectionScoringContext,
  type SuggestConnectionsFreshness,
  type SuggestConnectionsResult,
} from "@/lib/people-graph/scoring";
import {
  getSuggestedCandidateExposureCounts,
  getSuggestionObservabilitySnapshot,
  recordSuggestedCandidates,
  recordSuggestionExecution,
  type GraphFallbackReason,
  type SuggestionResultStrength,
} from "@/lib/people-graph/telemetry";
import {
  findBestProjectedPersonNameMatches,
  normalizeHumanNameText,
} from "@/lib/people-graph/name-matching";

export interface SuggestConnectionsArgs {
  person_type?: "member" | "alumni" | "parent";
  person_id?: string;
  person_query?: string;
  limit?: number;
  // How many scored suggestions to surface to the caller. The chat tool keeps the
  // conservative default (3); page-style surfaces pass a larger value. Always
  // clamped to the scored `limit` so we never display more than we computed.
  display_limit?: number;
}

const CHAT_CONNECTION_SUGGESTION_LIMIT = 3;

export class SuggestConnectionsLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuggestConnectionsLookupError";
  }
}

function buildFreshnessFromNow(): SuggestConnectionsFreshness {
  return {
    state: "fresh",
    as_of: new Date().toISOString(),
  };
}

async function loadProjectedPeople(
  serviceSupabase: SupabaseClient,
  orgId: string
): Promise<Map<string, ProjectedPerson>> {
  const [membersResponse, alumniResponse, parentsResponse] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serviceSupabase as any)
      .from("members")
      .select(MEMBER_PERSON_SELECT)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .is("deleted_at", null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serviceSupabase as any)
      .from("alumni")
      .select(ALUMNI_PERSON_SELECT)
      .eq("organization_id", orgId)
      .is("deleted_at", null),
    // Parents are consent-gated: only those who set open_to_networking enter the
    // candidate pool. Unclaimed parents (user_id NULL) cannot have opted in, so
    // they're inherently excluded.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serviceSupabase as any)
      .from("parents")
      .select(PARENT_PERSON_SELECT)
      .eq("organization_id", orgId)
      .eq("open_to_networking", true)
      .is("deleted_at", null),
  ]);

  if (membersResponse.error) {
    throw new Error("Failed to load members for suggestions");
  }

  if (alumniResponse.error) {
    throw new Error("Failed to load alumni for suggestions");
  }

  if (parentsResponse.error) {
    throw new Error("Failed to load parents for suggestions");
  }

  return buildProjectedPeople({
    members: (membersResponse.data ?? []) as MemberPersonRow[],
    alumni: (alumniResponse.data ?? []) as AlumniPersonRow[],
    parents: (parentsResponse.data ?? []) as ParentPersonRow[],
  });
}

async function fetchSourceRow(
  serviceSupabase: SupabaseClient,
  orgId: string,
  args: SuggestConnectionsArgs
) {
  if (!args.person_type || !args.person_id) {
    return null;
  }

  if (args.person_type === "member") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceSupabase as any)
      .from("members")
      .select(MEMBER_PERSON_SELECT)
      .eq("organization_id", orgId)
      .eq("id", args.person_id)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new Error("Failed to load source member");
    }

    return data as MemberPersonRow | null;
  }

  if (args.person_type === "parent") {
    // A parent is only a valid source if they themselves opted in (consent gate).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceSupabase as any)
      .from("parents")
      .select(PARENT_PERSON_SELECT)
      .eq("organization_id", orgId)
      .eq("id", args.person_id)
      .eq("open_to_networking", true)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new Error("Failed to load source parent");
    }

    return data as ParentPersonRow | null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (serviceSupabase as any)
    .from("alumni")
    .select(ALUMNI_PERSON_SELECT)
    .eq("organization_id", orgId)
    .eq("id", args.person_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load source alumni");
  }

  return data as AlumniPersonRow | null;
}

interface SourceComplement {
  memberRows: MemberPersonRow[];
  alumniRows: AlumniPersonRow[];
  parentRows: ParentPersonRow[];
}

// Load every active row sharing this user_id across the people tables, so a
// linked person projects to a single node regardless of which table the source
// came from. Parent complements are NOT consent-filtered here: if the user is a
// member/alumni, their member/alumni identity is the source and the parent row
// just enriches it; the consent gate only governs parent-as-candidate/parent-as-
// primary-source, both already enforced upstream.
async function loadRowsByUser(
  serviceSupabase: SupabaseClient,
  orgId: string,
  userId: string,
  tables: { members?: boolean; alumni?: boolean; parents?: boolean }
): Promise<Partial<SourceComplement>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = serviceSupabase as any;
  const result: Partial<SourceComplement> = {};

  if (tables.members) {
    const { data, error } = await client
      .from("members")
      .select(MEMBER_PERSON_SELECT)
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .eq("status", "active")
      .is("deleted_at", null);
    if (error) throw new Error("Failed to load source member complement");
    result.memberRows = (data as MemberPersonRow[] | null) ?? [];
  }

  if (tables.alumni) {
    const { data, error } = await client
      .from("alumni")
      .select(ALUMNI_PERSON_SELECT)
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .is("deleted_at", null);
    if (error) throw new Error("Failed to load source alumni complement");
    result.alumniRows = (data as AlumniPersonRow[] | null) ?? [];
  }

  if (tables.parents) {
    const { data, error } = await client
      .from("parents")
      .select(PARENT_PERSON_SELECT)
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .is("deleted_at", null);
    if (error) throw new Error("Failed to load source parent complement");
    result.parentRows = (data as ParentPersonRow[] | null) ?? [];
  }

  return result;
}

async function fetchSourceWithComplement(
  serviceSupabase: SupabaseClient,
  orgId: string,
  args: SuggestConnectionsArgs
): Promise<SourceComplement> {
  const sourceRow = await fetchSourceRow(serviceSupabase, orgId, args);

  if (!sourceRow) {
    return { memberRows: [], alumniRows: [], parentRows: [] };
  }

  if (args.person_type === "member") {
    const memberRow = sourceRow as MemberPersonRow;
    if (!memberRow.user_id) {
      return { memberRows: [memberRow], alumniRows: [], parentRows: [] };
    }
    const complement = await loadRowsByUser(serviceSupabase, orgId, memberRow.user_id, {
      alumni: true,
      parents: true,
    });
    return {
      memberRows: [memberRow],
      alumniRows: complement.alumniRows ?? [],
      parentRows: complement.parentRows ?? [],
    };
  }

  if (args.person_type === "parent") {
    const parentRow = sourceRow as ParentPersonRow;
    if (!parentRow.user_id) {
      return { memberRows: [], alumniRows: [], parentRows: [parentRow] };
    }
    const complement = await loadRowsByUser(serviceSupabase, orgId, parentRow.user_id, {
      members: true,
      alumni: true,
    });
    return {
      memberRows: complement.memberRows ?? [],
      alumniRows: complement.alumniRows ?? [],
      parentRows: [parentRow],
    };
  }

  const alumniRow = sourceRow as AlumniPersonRow;
  if (!alumniRow.user_id) {
    return { memberRows: [], alumniRows: [alumniRow], parentRows: [] };
  }
  const complement = await loadRowsByUser(serviceSupabase, orgId, alumniRow.user_id, {
    members: true,
    parents: true,
  });
  return {
    memberRows: complement.memberRows ?? [],
    alumniRows: [alumniRow],
    parentRows: complement.parentRows ?? [],
  };
}

const MIN_FUZZY_AUTORESOLVE_MARGIN = 15;
// Below this threshold a single fuzzy hit stays "ambiguous" — a lone typo
// suggestion is a near-miss the user should confirm, not an auto-resolution.
const MIN_FUZZY_AUTORESOLVE_SCORE = 50;

function resolveSourceFromQuery(
  projectedPeople: Map<string, ProjectedPerson>,
  personQuery: string
):
  | { state: "resolved"; source: ProjectedPerson }
  | { state: "ambiguous"; options: ProjectedPerson[] }
  | { state: "not_found" } {
  const normalizedQuery = normalizeHumanNameText(personQuery);

  const emailMatches = [...projectedPeople.values()].filter((person) => {
    const normalizedEmail = person.email ? normalizeHumanNameText(person.email) : "";
    return normalizedEmail.length > 0 && normalizedEmail === normalizedQuery;
  });

  if (emailMatches.length === 1) {
    return { state: "resolved", source: emailMatches[0] };
  }

  if (emailMatches.length > 1) {
    emailMatches.sort((left, right) => {
      const leftName = left.name.localeCompare(right.name);
      if (leftName !== 0) return leftName;
      return left.personId.localeCompare(right.personId);
    });
    return { state: "ambiguous", options: emailMatches };
  }

  const exactNameMatches = [...projectedPeople.values()].filter((person) => {
    const normalizedName = normalizeHumanNameText(person.name);
    return normalizedName.length > 0 && normalizedName === normalizedQuery;
  });

  if (exactNameMatches.length === 1) {
    return { state: "resolved", source: exactNameMatches[0] };
  }

  if (exactNameMatches.length > 1) {
    exactNameMatches.sort((left, right) => {
      const leftName = left.name.localeCompare(right.name);
      if (leftName !== 0) return leftName;
      return left.personId.localeCompare(right.personId);
    });
    return { state: "ambiguous", options: exactNameMatches };
  }

  const fuzzyMatches = findBestProjectedPersonNameMatches(projectedPeople.values(), personQuery);
  if (fuzzyMatches.length === 0) {
    return { state: "not_found" };
  }

  const topMatch = fuzzyMatches[0];
  const runnerUp = fuzzyMatches[1] ?? null;
  const clearWinner = !runnerUp || topMatch.score - runnerUp.score >= MIN_FUZZY_AUTORESOLVE_MARGIN;

  if (clearWinner && topMatch.score >= MIN_FUZZY_AUTORESOLVE_SCORE) {
    return { state: "resolved", source: topMatch.person };
  }

  return {
    state: "ambiguous",
    options: fuzzyMatches.slice(0, 3).map((match) => match.person),
  };
}

async function loadOrganizationName(
  serviceSupabase: SupabaseClient,
  orgId: string
): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceSupabase as any)
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();

    if (error) {
      return null;
    }

    const name =
      data && typeof data === "object" && typeof (data as { name?: unknown }).name === "string"
        ? (data as { name: string }).name
        : null;

    return name?.trim() || null;
  } catch {
    return null;
  }
}

function buildExposurePenaltyByPersonId(orgId: string) {
  const counts = getSuggestedCandidateExposureCounts(orgId);
  const penalties = new Map<string, number>();

  for (const [personId, appearances] of counts.entries()) {
    let penalty = 0;
    if (appearances >= 10) {
      penalty = 15;
    } else if (appearances >= 6) {
      penalty = 10;
    } else if (appearances >= 3) {
      penalty = 5;
    }

    if (penalty > 0) {
      penalties.set(personId, penalty);
    }
  }

  return penalties;
}

export interface CandidatePoolEntry {
  candidate: ProjectedPerson;
  qualificationCodes: CandidateQualificationCode[];
}

/**
 * Consent gate. A person surfaces as a candidate only when they opted in via
 * open_to_networking, whatever their person type — this is the promise the
 * consent toggle makes ("turn this off to stay out of others' suggestions").
 * Members and alumni are backfilled to opted-in (opt-out model, migration
 * 20261230000000); parents stay opt-in and are additionally filtered to
 * open_to_networking=true at the query level as defense in depth.
 * Source-side rules:
 *   - a parent source must have opted in;
 *   - alumni → alumni surfaces only when the SOURCE alumnus also opted in
 *     (reciprocity rule shipped with #313).
 */
export function isConnectionEdgeAllowed(
  source: ProjectedPerson,
  candidate: ProjectedPerson
): boolean {
  if (!candidate.openToNetworking) {
    return false;
  }
  if (source.personType === "parent" && !source.openToNetworking) {
    return false;
  }
  // alumni → alumni requires the source alumnus to be open to networking.
  if (
    source.personType === "alumni" &&
    candidate.personType === "alumni" &&
    !source.openToNetworking
  ) {
    return false;
  }
  return true;
}

export function buildCandidatePool(input: {
  source: ProjectedPerson;
  candidates: Iterable<ProjectedPerson>;
  limit: number;
  scoringContext?: ConnectionScoringContext;
}) {
  const professionalEntries: CandidatePoolEntry[] = [];
  const weakSupportEntries: CandidatePoolEntry[] = [];

  for (const candidate of input.candidates) {
    if (candidate.personKey === input.source.personKey) {
      continue;
    }

    if (!isConnectionEdgeAllowed(input.source, candidate)) {
      continue;
    }

    const signals = inspectCandidateSignals({
      source: input.source,
      candidate,
      scoringContext: input.scoringContext,
    });
    const qualificationCodes = getCandidateQualificationCodes(signals);
    if (qualificationCodes.length === 0) {
      continue;
    }

    const entry = { candidate, qualificationCodes };
    if (hasProfessionalStrengthQualification(qualificationCodes)) {
      professionalEntries.push(entry);
    } else {
      weakSupportEntries.push(entry);
    }
  }

  if (professionalEntries.length >= input.limit * 5) {
    return professionalEntries;
  }

  return [
    ...professionalEntries,
    ...weakSupportEntries.slice(0, Math.max(0, input.limit * 5 - professionalEntries.length)),
  ];
}

export function scoreProjectedCandidates(input: {
  source: ProjectedPerson;
  allPeople: Iterable<ProjectedPerson>;
  candidates: Iterable<ProjectedPerson>;
  limit: number;
  scoringContext?: ConnectionScoringContext;
}) {
  const rarityStats = buildConnectionRarityStats({
    people: input.allPeople,
    scoringContext: input.scoringContext,
  });
  const exposurePenaltyByPersonId = buildExposurePenaltyByPersonId(input.source.orgId);
  const strongSuggestions = [];
  const weakSuggestions = [];
  const candidatePool = buildCandidatePool({
    source: input.source,
    candidates: input.candidates,
    limit: input.limit,
    scoringContext: input.scoringContext,
  });

  for (const { candidate } of candidatePool) {
    const suggestion = buildSuggestionForCandidate({
      source: input.source,
      candidate,
      scoringContext: {
        ...input.scoringContext,
        rarityStats,
        exposurePenaltyByPersonId,
      },
    });
    if (!suggestion) {
      continue;
    }

    if (hasProfessionalStrengthReason(suggestion)) {
      strongSuggestions.push(suggestion);
    } else {
      weakSuggestions.push(suggestion);
    }
  }

  const results = strongSuggestions.length > 0 ? strongSuggestions : weakSuggestions;
  return sortSuggestedConnections(results).slice(0, input.limit);
}

function classifySuggestionResultStrength(
  suggestions: SuggestConnectionsResult["suggestions"]
): SuggestionResultStrength {
  if (suggestions.length === 0) {
    return "none";
  }

  return suggestions.some((suggestion) =>
    suggestion.reasons.some((reason) =>
      ["shared_industry", "shared_company", "shared_role_family"].includes(reason.code)
    )
  )
    ? "strong"
    : "weak_fallback";
}

function buildLookupOnlyResult(input: {
  state: "ambiguous" | "not_found";
  sourcePerson?: ProjectedPerson | null;
  options?: ProjectedPerson[];
}): SuggestConnectionsResult {
  return {
    mode: "sql_fallback",
    fallback_reason: null,
    freshness: {
      state: "unknown",
      as_of: new Date().toISOString(),
    },
    state: input.state,
    source_person: input.sourcePerson
      ? buildDisplayReadyConnectionPerson(input.sourcePerson)
      : null,
    suggestions: [],
    ...(input.options
      ? {
          disambiguation_options: input.options.map((person) =>
            buildDisplayReadyConnectionPerson(person)
          ),
        }
      : {}),
  };
}

function buildResolvedResult(input: {
  mode: "sql_fallback";
  fallbackReason: GraphFallbackReason | null;
  freshness: SuggestConnectionsFreshness;
  source: ProjectedPerson;
  results: ReturnType<typeof sortSuggestedConnections>;
  displayLimit: number;
}): SuggestConnectionsResult {
  const displaySuggestions = input.results
    .slice(0, input.displayLimit)
    .map((suggestion) => buildDisplayReadySuggestedConnection(suggestion));

  return {
    mode: input.mode,
    fallback_reason: input.fallbackReason,
    freshness: input.freshness,
    state: displaySuggestions.length > 0 ? "resolved" : "no_suggestions",
    source_person: buildDisplayReadyConnectionPerson(input.source),
    suggestions: displaySuggestions,
  };
}

export async function suggestConnections(input: {
  orgId: string;
  serviceSupabase: SupabaseClient;
  args: SuggestConnectionsArgs;
}): Promise<SuggestConnectionsResult> {
  const limit = clampSuggestionsLimit(input.args.limit);
  // Default to the chat cap when the caller doesn't ask for more; a caller-supplied
  // display_limit lets page surfaces show more. Never exceed the scored `limit`.
  const requestedDisplayLimit = input.args.display_limit ?? CHAT_CONNECTION_SUGGESTION_LIMIT;
  const displayLimit = Math.min(limit, Math.max(requestedDisplayLimit, 1));
  const { orgId, serviceSupabase } = input;
  let resolvedSource: ProjectedPerson | null = null;
  let projectedPeopleForLookup: Map<string, ProjectedPerson> | null = null;
  const organizationName = await loadOrganizationName(serviceSupabase, orgId);
  const scoringContext: ConnectionScoringContext = {
    genericCompanyValues: ["TeamNetwork", normalizeConnectionText(organizationName)],
  };

  if (input.args.person_query) {
    projectedPeopleForLookup = await loadProjectedPeople(serviceSupabase, orgId);
    const resolution = resolveSourceFromQuery(projectedPeopleForLookup, input.args.person_query);

    if (resolution.state === "not_found") {
      return buildLookupOnlyResult({ state: "not_found" });
    }

    if (resolution.state === "ambiguous") {
      return buildLookupOnlyResult({
        state: "ambiguous",
        options: resolution.options,
      });
    }

    resolvedSource = resolution.source;
  } else {
    const { memberRows, alumniRows, parentRows } = await fetchSourceWithComplement(
      serviceSupabase,
      orgId,
      input.args
    );

    const source = buildSourcePerson({ memberRows, alumniRows, parentRows });
    if (!source) {
      throw new SuggestConnectionsLookupError("Person not found");
    }

    resolvedSource = source;
  }

  if (!resolvedSource) {
    throw new SuggestConnectionsLookupError("Person not found");
  }

  const projectedPeople = projectedPeopleForLookup
    ? projectedPeopleForLookup
    : await loadProjectedPeople(serviceSupabase, orgId);
  const projectedSource =
    projectedPeople.get(`${orgId}:${resolvedSource.personKey}`) ?? resolvedSource;

  async function computeSqlResult(
    fallbackReason: GraphFallbackReason | null,
    freshness: SuggestConnectionsFreshness
  ): Promise<SuggestConnectionsResult> {
    const results = scoreProjectedCandidates({
      source: projectedSource,
      allPeople: projectedPeople.values(),
      candidates: projectedPeople.values(),
      limit,
      scoringContext,
    });
    return buildResolvedResult({
      mode: "sql_fallback",
      fallbackReason,
      freshness,
      source: projectedSource,
      results,
      displayLimit,
    });
  }

  function finalizeResult(result: SuggestConnectionsResult) {
    if (result.state === "resolved") {
      recordSuggestedCandidates({
        orgId,
        personIds: result.suggestions.slice(0, 3).map((suggestion) => suggestion.person_id),
      });
    }
    recordSuggestionExecution({
      orgId,
      mode: result.mode,
      fallbackReason: result.fallback_reason,
      freshnessState: result.freshness.state,
      resultStrength: classifySuggestionResultStrength(result.suggestions),
    });
    return result;
  }

  // The people-graph is served from Postgres (mentorship_pairs + member/alumni
  // projections), not a separate graph store, so suggestions always read live
  // SQL — the result is therefore always current.
  return finalizeResult(await computeSqlResult(null, buildFreshnessFromNow()));
}

export function getSuggestionObservabilityByOrg(orgId: string) {
  return getSuggestionObservabilitySnapshot(orgId);
}
