import { createClient } from "@/lib/supabase/server";

type SearchEventName = "search_used" | "search_result_click";

/**
 * Fire consent-gated behavioral analytics from API routes (session cookie context).
 */
export async function logBehavioralEventFromApi(
  orgId: string,
  eventName: SearchEventName,
  props: Record<string, string | number | boolean | null>,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: consent } = await supabase
    .from("analytics_consent")
    .select("consent_state")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (consent?.consent_state !== "opted_in") return;

  const clientDay = new Date().toISOString().slice(0, 10);
  const sessionId = crypto.randomUUID();

  await supabase.rpc("log_analytics_event", {
    p_org_id: orgId,
    p_session_id: sessionId,
    p_client_day: clientDay,
    p_platform: "web",
    p_device_class: "unknown",
    p_app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
    p_route: "/api/search",
    p_event_name: eventName,
    p_props: {
      ...props,
      referrer_type: "direct",
      consent_state: "opted_in",
    },
  });
}
