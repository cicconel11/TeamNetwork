import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ALUMNI_PERSON_SELECT,
  buildPersonKey,
  buildProjectedPeople,
  isActiveMentorshipPairRow,
  MEMBER_PERSON_SELECT,
  MENTORSHIP_PAIR_SELECT,
  type AlumniPersonRow,
  type MemberPersonRow,
  type MentorshipPairSyncRow,
  type ProjectedPerson,
} from "@/lib/falkordb/people";
import { falkorClient, type FalkorQueryClient } from "@/lib/falkordb/client";
import { toErrorMessage } from "@/lib/falkordb/utils";

export interface GraphQueueStats {
  processed: number;
  skipped: number;
  failed: number;
}

interface GraphQueueItem {
  id: string;
  org_id: string;
  source_table: string;
  source_id: string;
  action: string;
  payload: Record<string, unknown> | null;
}

interface ProcessOptions {
  batchSize?: number;
  graphClient?: FalkorQueryClient;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function compactGraphProperties(person: ProjectedPerson) {
  const properties: Record<string, string | number> = {
    orgId: person.orgId,
    personKey: person.personKey,
    personType: person.personType,
    personId: person.personId,
    name: person.name,
  };

  if (person.memberId) properties.memberId = person.memberId;
  if (person.alumniId) properties.alumniId = person.alumniId;
  if (person.userId) properties.userId = person.userId;
  if (person.role) properties.role = person.role;
  if (person.major) properties.major = person.major;
  if (person.currentCompany) properties.currentCompany = person.currentCompany;
  if (person.industry) properties.industry = person.industry;
  if (typeof person.graduationYear === "number") {
    properties.graduationYear = person.graduationYear;
  }
  if (person.currentCity) properties.currentCity = person.currentCity;

  return properties;
}

async function incrementAttempts(
  serviceSupabase: SupabaseClient,
  id: string,
  errorMessage: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (serviceSupabase as any).rpc("increment_graph_sync_attempts", {
    p_id: id,
    p_error: errorMessage.slice(0, 500),
  });

  if (error) {
    console.error("[graph-sync] increment attempts RPC failed:", error);
  }
}

async function deletePersonNode(
  graphClient: FalkorQueryClient,
  orgId: string,
  personKey: string
) {
  await graphClient.query(
    orgId,
    "MATCH (person:Person {personKey: $personKey}) DETACH DELETE person RETURN $personKey AS personKey",
    { personKey }
  );
}

async function upsertPersonNode(
  graphClient: FalkorQueryClient,
  orgId: string,
  person: ProjectedPerson
) {
  await graphClient.query(
    orgId,
    "MERGE (person:Person {personKey: $personKey}) SET person = $props RETURN person.personKey AS personKey",
    {
      personKey: person.personKey,
      props: compactGraphProperties(person),
    }
  );
}

async function fetchActiveMembersByUserId(
  serviceSupabase: SupabaseClient,
  orgId: string,
  userId: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (serviceSupabase as any)
    .from("members")
    .select(MEMBER_PERSON_SELECT)
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null);

  if (error) {
    throw new Error("Failed to load members for graph sync");
  }

  return (data ?? []) as MemberPersonRow[];
}

async function fetchActiveAlumniByUserId(
  serviceSupabase: SupabaseClient,
  orgId: string,
  userId: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (serviceSupabase as any)
    .from("alumni")
    .select(ALUMNI_PERSON_SELECT)
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) {
    throw new Error("Failed to load alumni for graph sync");
  }

  return (data ?? []) as AlumniPersonRow[];
}

async function fetchActiveMemberById(
  serviceSupabase: SupabaseClient,
  orgId: string,
  memberId: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (serviceSupabase as any)
    .from("members")
    .select(MEMBER_PERSON_SELECT)
    .eq("organization_id", orgId)
    .eq("id", memberId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load member for graph sync");
  }

  return (data ? [data] : []) as MemberPersonRow[];
}

async function fetchActiveAlumniById(
  serviceSupabase: SupabaseClient,
  orgId: string,
  alumniId: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (serviceSupabase as any)
    .from("alumni")
    .select(ALUMNI_PERSON_SELECT)
    .eq("organization_id", orgId)
    .eq("id", alumniId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load alumni for graph sync");
  }

  return (data ? [data] : []) as AlumniPersonRow[];
}

async function fetchPairById(serviceSupabase: SupabaseClient, pairId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (serviceSupabase as any)
    .from("mentorship_pairs")
    .select(MENTORSHIP_PAIR_SELECT)
    .eq("id", pairId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load mentorship pair for graph sync");
  }

  return data as MentorshipPairSyncRow | null;
}

async function fetchPersonRecordById(
  serviceSupabase: SupabaseClient,
  sourceTable: "members" | "alumni",
  sourceId: string
) {
  const select = sourceTable === "members" ? MEMBER_PERSON_SELECT : ALUMNI_PERSON_SELECT;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (serviceSupabase as any)
    .from(sourceTable)
    .select(select)
    .eq("id", sourceId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load ${sourceTable} row for graph sync`);
  }

  return data as MemberPersonRow | AlumniPersonRow | null;
}

async function fetchAdjacentPairs(
  serviceSupabase: SupabaseClient,
  orgId: string,
  userId: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (serviceSupabase as any)
    .from("mentorship_pairs")
    .select(MENTORSHIP_PAIR_SELECT)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .eq("status", "active")
    .or(`mentor_user_id.eq.${userId},mentee_user_id.eq.${userId}`);

  if (error) {
    throw new Error("Failed to load adjacent mentorship pairs");
  }

  return (data ?? []) as MentorshipPairSyncRow[];
}

async function hasActivePair(
  serviceSupabase: SupabaseClient,
  orgId: string,
  mentorUserId: string,
  menteeUserId: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (serviceSupabase as any)
    .from("mentorship_pairs")
    .select("id")
    .eq("organization_id", orgId)
    .eq("mentor_user_id", mentorUserId)
    .eq("mentee_user_id", menteeUserId)
    .eq("status", "active")
    .is("deleted_at", null)
    .limit(1);

  if (error) {
    throw new Error("Failed to check mentorship edge state");
  }

  return Array.isArray(data) && data.length > 0;
}

async function reconcilePairByUsers(
  serviceSupabase: SupabaseClient,
  graphClient: FalkorQueryClient,
  orgId: string,
  mentorUserId: string,
  menteeUserId: string
) {
  if (!mentorUserId || !menteeUserId) {
    return;
  }

  const mentorKey = buildPersonKey("members", mentorUserId, mentorUserId);
  const menteeKey = buildPersonKey("members", menteeUserId, menteeUserId);
  const edgeExists = await hasActivePair(serviceSupabase, orgId, mentorUserId, menteeUserId);

  if (edgeExists) {
    await graphClient.query(
      orgId,
      `
        MATCH (mentor:Person {personKey: $mentorKey})
        MATCH (mentee:Person {personKey: $menteeKey})
        MERGE (mentor)-[:MENTORS]->(mentee)
        RETURN mentor.personKey AS mentorKey
      `,
      { mentorKey, menteeKey }
    );
    return;
  }

  await graphClient.query(
    orgId,
    `
      MATCH (mentor:Person {personKey: $mentorKey})-[edge:MENTORS]->(mentee:Person {personKey: $menteeKey})
      DELETE edge
      RETURN mentor.personKey AS mentorKey
    `,
    { mentorKey, menteeKey }
  );
}

async function reconcileAdjacentPairsForUser(
  serviceSupabase: SupabaseClient,
  graphClient: FalkorQueryClient,
  person: ProjectedPerson
) {
  if (!person.userId) {
    return;
  }

  const pairs = await fetchAdjacentPairs(serviceSupabase, person.orgId, person.userId);
  const seen = new Set<string>();

  for (const pair of pairs.filter(isActiveMentorshipPairRow)) {
    const pairKey = `${pair.mentor_user_id}:${pair.mentee_user_id}`;
    if (seen.has(pairKey)) {
      continue;
    }
    seen.add(pairKey);
    await reconcilePairByUsers(
      serviceSupabase,
      graphClient,
      person.orgId,
      pair.mentor_user_id,
      pair.mentee_user_id
    );
  }
}

async function reconcilePersonByKey(
  serviceSupabase: SupabaseClient,
  graphClient: FalkorQueryClient,
  orgId: string,
  personKey: string
) {
  let members: MemberPersonRow[] = [];
  let alumni: AlumniPersonRow[] = [];

  if (personKey.startsWith("user:")) {
    const userId = personKey.slice("user:".length);
    [members, alumni] = await Promise.all([
      fetchActiveMembersByUserId(serviceSupabase, orgId, userId),
      fetchActiveAlumniByUserId(serviceSupabase, orgId, userId),
    ]);
  } else if (personKey.startsWith("member:")) {
    members = await fetchActiveMemberById(serviceSupabase, orgId, personKey.slice("member:".length));
  } else if (personKey.startsWith("alumni:")) {
    alumni = await fetchActiveAlumniById(serviceSupabase, orgId, personKey.slice("alumni:".length));
  } else {
    throw new Error(`Unknown person key: ${personKey}`);
  }

  const projected = buildProjectedPeople({ members, alumni }).get(personKey);

  if (!projected) {
    await deletePersonNode(graphClient, orgId, personKey);
    return;
  }

  await upsertPersonNode(graphClient, orgId, projected);
  await reconcileAdjacentPairsForUser(serviceSupabase, graphClient, projected);
}

async function handlePersonQueueItem(
  serviceSupabase: SupabaseClient,
  graphClient: FalkorQueryClient,
  item: GraphQueueItem,
  sourceTable: "members" | "alumni"
) {
  const payload = item.payload ?? {};
  const row = await fetchPersonRecordById(serviceSupabase, sourceTable, item.source_id);
  const oldUserId = readOptionalString(payload.old_user_id);
  const oldOrgId = readOptionalString(payload.old_organization_id) ?? item.org_id;

  if (!row) {
    const oldKey = buildPersonKey(sourceTable, item.source_id, oldUserId);
    await reconcilePersonByKey(serviceSupabase, graphClient, oldOrgId, oldKey);
    return;
  }

  const newKey = buildPersonKey(sourceTable, row.id, row.user_id);
  const oldKey = buildPersonKey(sourceTable, row.id, oldUserId);

  if (oldOrgId !== item.org_id || oldKey !== newKey) {
    await reconcilePersonByKey(serviceSupabase, graphClient, oldOrgId, oldKey);
  }

  await reconcilePersonByKey(serviceSupabase, graphClient, item.org_id, newKey);
}

async function handleMentorshipQueueItem(
  serviceSupabase: SupabaseClient,
  graphClient: FalkorQueryClient,
  item: GraphQueueItem
) {
  const payload = item.payload ?? {};
  const pair = await fetchPairById(serviceSupabase, item.source_id);

  const pairTargets = new Map<string, { orgId: string; mentorUserId: string; menteeUserId: string }>();
  const oldOrgId = readOptionalString(payload.old_organization_id) ?? item.org_id;
  const oldMentorUserId = readOptionalString(payload.old_mentor_user_id);
  const oldMenteeUserId = readOptionalString(payload.old_mentee_user_id);

  if (oldMentorUserId && oldMenteeUserId) {
    pairTargets.set(`old:${oldOrgId}:${oldMentorUserId}:${oldMenteeUserId}`, {
      orgId: oldOrgId,
      mentorUserId: oldMentorUserId,
      menteeUserId: oldMenteeUserId,
    });
  }

  if (pair) {
    pairTargets.set(
      `current:${pair.organization_id}:${pair.mentor_user_id}:${pair.mentee_user_id}`,
      {
        orgId: pair.organization_id,
        mentorUserId: pair.mentor_user_id,
        menteeUserId: pair.mentee_user_id,
      }
    );
  }

  for (const target of pairTargets.values()) {
    await reconcilePairByUsers(
      serviceSupabase,
      graphClient,
      target.orgId,
      target.mentorUserId,
      target.menteeUserId
    );
  }
}

export async function processGraphSyncQueue(
  serviceSupabase: SupabaseClient,
  options?: ProcessOptions
): Promise<GraphQueueStats> {
  const graphClient = options?.graphClient ?? falkorClient;
  const batchSize = options?.batchSize ?? 50;
  const stats: GraphQueueStats = { processed: 0, skipped: 0, failed: 0 };

  if (!graphClient.isAvailable()) {
    return stats;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: queueItems, error: dequeueError } = await (serviceSupabase as any).rpc(
    "dequeue_graph_sync_queue",
    { p_batch_size: batchSize }
  );

  if (dequeueError || !queueItems || queueItems.length === 0) {
    if (dequeueError) {
      console.error("[graph-sync] dequeue failed:", dequeueError);
    }
    return stats;
  }

  for (const item of queueItems as GraphQueueItem[]) {
    try {
      switch (item.source_table) {
        case "members":
          await handlePersonQueueItem(serviceSupabase, graphClient, item, "members");
          stats.processed++;
          break;
        case "alumni":
          await handlePersonQueueItem(serviceSupabase, graphClient, item, "alumni");
          stats.processed++;
          break;
        case "mentorship_pairs":
          await handleMentorshipQueueItem(serviceSupabase, graphClient, item);
          stats.processed++;
          break;
        default:
          stats.skipped++;
          break;
      }
    } catch (error) {
      stats.failed++;
      await incrementAttempts(serviceSupabase, item.id, toErrorMessage(error, "unknown_graph_sync_error"));
    }
  }

  return stats;
}
