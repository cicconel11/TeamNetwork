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

    const { data: existing } = await supabase
      .from("stripe_events")
      .select("*")
      .eq("event_id", eventId)
      .maybeSingle();

    if (!existing) {
      throw error;
    }

    return { eventRow: existing, alreadyProcessed: Boolean(existing.processed_at) };
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
