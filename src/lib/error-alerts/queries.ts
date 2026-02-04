import type { SupabaseClient } from "@supabase/supabase-js";

// Note: error_groups table is defined in migration but types may not be regenerated yet
// Using generic SupabaseClient until types are updated

export interface ErrorGroup {
  id: string;
  fingerprint: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  env: string;
  first_seen_at: string;
  last_seen_at: string;
  count_1h: number;
  count_24h: number;
  total_count: number;
  first_notified_at: string | null;
  last_notified_at: string | null;
  sample_event: Record<string, unknown>;
  status: "open" | "resolved" | "ignored" | "muted";
}

export interface FetchOptions {
  spikeThreshold?: number;
  spikeCooldownHours?: number;
  maxBatchSize?: number;
}

const DEFAULT_SPIKE_THRESHOLD = 10;
const DEFAULT_SPIKE_COOLDOWN_HOURS = 1;
const DEFAULT_MAX_BATCH_SIZE = 50;

/**
 * Fetch error groups that need notification:
 * - New errors (first_notified_at IS NULL)
 * - Spike alerts (count_1h >= threshold AND cooldown expired)
 *
 * Only considers groups with status = 'open'
 */
export async function fetchGroupsNeedingNotification(
  supabase: SupabaseClient,
  options: FetchOptions = {}
): Promise<{ data: ErrorGroup[]; error: Error | null }> {
  const spikeThreshold = options.spikeThreshold ?? DEFAULT_SPIKE_THRESHOLD;
  const spikeCooldownHours = options.spikeCooldownHours ?? DEFAULT_SPIKE_COOLDOWN_HOURS;
  const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;

  const cooldownCutoff = new Date(
    Date.now() - spikeCooldownHours * 60 * 60 * 1000
  ).toISOString();

  // Query for groups needing notification:
  // 1. Status must be 'open'
  // 2. Either never notified (new error) OR spike with cooldown expired
  const { data, error } = await supabase
    .from("error_groups")
    .select("*")
    .eq("status", "open")
    .or(
      `first_notified_at.is.null,and(count_1h.gte.${spikeThreshold},last_notified_at.lt.${cooldownCutoff})`
    )
    .order("last_seen_at", { ascending: false })
    .limit(maxBatchSize);

  if (error) {
    return { data: [], error: new Error(error.message) };
  }

  return { data: (data as ErrorGroup[]) || [], error: null };
}

export interface UpdateOptions {
  isFirstNotification?: boolean;
}

/**
 * Update notification timestamps for an error group.
 * Sets first_notified_at if this is the first notification.
 * Always updates last_notified_at.
 */
export async function updateNotificationTimestamps(
  supabase: SupabaseClient,
  groupId: string,
  options: UpdateOptions = {}
): Promise<{ error: Error | null }> {
  const now = new Date().toISOString();

  const updateData: Record<string, string> = {
    last_notified_at: now,
  };

  if (options.isFirstNotification) {
    updateData.first_notified_at = now;
  }

  const { error } = await supabase
    .from("error_groups")
    .update(updateData)
    .eq("id", groupId);

  if (error) {
    return { error: new Error(error.message) };
  }

  return { error: null };
}

export interface ErrorEvent {
  id: string;
  group_id: string;
  env: string;
  user_id: string | null;
  session_id: string | null;
  route: string | null;
  api_path: string | null;
  message: string;
  stack: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface FetchErrorGroupsOptions {
  status?: ErrorGroup["status"];
  limit?: number;
}

/**
 * Fetch all error groups with optional status filter
 */
export async function fetchErrorGroups(
  supabase: SupabaseClient,
  options: FetchErrorGroupsOptions = {}
): Promise<{ data: ErrorGroup[]; error: Error | null }> {
  const { status, limit = 100 } = options;

  let query = supabase
    .from("error_groups")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    return { data: [], error: new Error(error.message) };
  }

  return { data: (data as ErrorGroup[]) || [], error: null };
}

/**
 * Fetch a single error group by ID
 */
export async function fetchErrorGroupById(
  supabase: SupabaseClient,
  groupId: string
): Promise<{ data: ErrorGroup | null; error: Error | null }> {
  const { data, error } = await supabase
    .from("error_groups")
    .select("*")
    .eq("id", groupId)
    .single();

  if (error) {
    return { data: null, error: new Error(error.message) };
  }

  return { data: data as ErrorGroup, error: null };
}

/**
 * Fetch error events for a specific group
 */
export async function fetchErrorEvents(
  supabase: SupabaseClient,
  groupId: string,
  limit: number = 50
): Promise<{ data: ErrorEvent[]; error: Error | null }> {
  const { data, error } = await supabase
    .from("error_events")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { data: [], error: new Error(error.message) };
  }

  return { data: (data as ErrorEvent[]) || [], error: null };
}

/**
 * Update error group status
 */
export async function updateErrorGroupStatus(
  supabase: SupabaseClient,
  groupId: string,
  status: ErrorGroup["status"]
): Promise<{ data: ErrorGroup | null; error: Error | null }> {
  const { data, error } = await supabase
    .from("error_groups")
    .update({ status })
    .eq("id", groupId)
    .select()
    .single();

  if (error) {
    return { data: null, error: new Error(error.message) };
  }

  return { data: data as ErrorGroup, error: null };
}
