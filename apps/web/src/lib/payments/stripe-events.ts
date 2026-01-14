import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { Database } from "@teammeet/types";

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

    const { data: existing } = await supabase
      .from("stripe_events")
      .select("*")
      .eq("event_id", eventId)
      .maybeSingle();

    if (!existing) {
      throw error;
    }

    // Already fully processed — skip
    if (existing.processed_at) {
      return { eventRow: existing, alreadyProcessed: true };
    }

    // Active lease: another worker inserted recently and is still processing — skip
    const STALE_LEASE_MS = 5 * 60 * 1000; // 5 minutes
    const createdAt = new Date(existing.created_at as string).getTime();
    const isStale = Date.now() - createdAt > STALE_LEASE_MS;

    if (!isStale) {
      return { eventRow: existing, alreadyProcessed: true };
    }

    // Stale lease: original worker likely crashed — allow re-processing
    return { eventRow: existing, alreadyProcessed: false };
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
