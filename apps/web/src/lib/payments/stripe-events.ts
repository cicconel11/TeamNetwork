import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type DbClient = SupabaseClient<Database, "public">;
export type StripeEventRow = Database["public"]["Tables"]["stripe_events"]["Row"];
export type StripeEventInsert = Database["public"]["Tables"]["stripe_events"]["Insert"];

const UNIQUE_VIOLATION = "23505";

export async function registerStripeEvent(params: {
  supabase: DbClient;
  eventId: string;
  type: string;
  payload?: StripeEventInsert["payload_json"];
}) {
  const { supabase, eventId, type, payload } = params;

  const { data, error } = await supabase
    .from("stripe_events")
    .insert({
      event_id: eventId,
      type,
      payload_json: payload ?? null,
    })
    .select()
    .single();

  if (error) {
    const pgError = error as PostgrestError;
    if (pgError.code !== UNIQUE_VIOLATION) {
      throw error;
    }

    // M9 fix: check error on secondary SELECT
    const { data: existing, error: selectError } = await supabase
      .from("stripe_events")
      .select("*")
      .eq("event_id", eventId)
      .maybeSingle();

    if (selectError || !existing) {
      throw selectError ?? error;
    }

    // Already fully processed — skip
    if (existing.processed_at) {
      return { eventRow: existing, alreadyProcessed: true };
    }

    // Attempt atomic lease claim via RPC — only succeeds if lease is stale (>5 min)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: claimed, error: claimError } = await (supabase as any)
      .rpc("claim_stale_stripe_event", { p_event_id: eventId });

    if (claimError) {
      throw claimError;
    }

    const claimedRows = claimed as unknown as StripeEventRow[];
    if (!claimedRows || claimedRows.length === 0) {
      // Lease is still active (another worker is processing) — skip
      return { eventRow: existing, alreadyProcessed: true };
    }

    // Successfully claimed stale lease — allow re-processing
    return { eventRow: claimedRows[0], alreadyProcessed: false };
  }

  return { eventRow: data, alreadyProcessed: false };
}

export async function markStripeEventProcessed(
  supabase: DbClient,
  eventId: string,
  processedAt: string = new Date().toISOString(),
) {
  const { data, error } = await supabase
    .from("stripe_events")
    .update({ processed_at: processedAt })
    .eq("event_id", eventId)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}
