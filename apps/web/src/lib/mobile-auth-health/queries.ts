import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Mobile-auth handoff health: created-vs-consumed monitoring.
 *
 * Background: the web->mobile sign-in handoff mints a short-lived one-time code
 * (`mobile_auth_handoffs`) that the native app consumes to exchange for a
 * Supabase session. A regression where many codes are created but almost none
 * are consumed (the "37 created / 3 consumed" incident) means users can start
 * the flow on web but never land signed-in on mobile — and used to require a
 * manual Supabase query to notice. These helpers turn that into an automatic
 * signal an hourly cron can page on.
 *
 * The table is RLS-enabled with no policies, so callers MUST pass a
 * service-role client. These helpers are pure/side-effect-free (no logging, no
 * email) so the count logic and the threshold logic can be unit-tested in
 * isolation from the cron wrapper.
 */

// ── Tunable defaults ─────────────────────────────────────────────────────────

/**
 * Rolling window the cron evaluates over. 24h (not 1h) is deliberate: the code
 * TTL is only ~5 minutes, so a code created near the end of a 1h window may not
 * yet have had a fair chance to be consumed inside that same window, biasing
 * the ratio downward and risking false alarms. A 24h window means essentially
 * every code counted as "created" has already lived out its full lifetime, so
 * created-vs-consumed is an honest measure. The cron still runs hourly, so an
 * incident is detected within ~1h of enough volume accumulating.
 */
export const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Minimum number of codes created in the window before the ratio is trusted.
 * Below this we stay silent to avoid paging on low-volume noise (e.g. a single
 * developer testing 2 codes and abandoning 1 is not an incident).
 */
export const DEFAULT_FLOOR = 10;

/**
 * Alert when the consumed/created ratio drops below this. Healthy handoff
 * completion sits well above 0.5; the 37/3 incident was ~0.08. 0.5 leaves wide
 * headroom for legitimate user drop-off (users who start on web but never open
 * the app) while still catching a real regression.
 */
export const DEFAULT_MIN_CONSUME_RATIO = 0.5;

// ── Count query ──────────────────────────────────────────────────────────────

export interface HandoffHealthCounts {
  created: number;
  consumed: number;
  /** ISO timestamp marking the start of the evaluated window. */
  windowStart: string;
}

export interface ComputeHandoffHealthOptions {
  /** Window length in ms. Defaults to {@link DEFAULT_WINDOW_MS}. */
  windowMs?: number;
  /** Injectable clock for deterministic tests. Defaults to `Date.now()`. */
  now?: number;
}

/**
 * Count handoff codes created vs consumed within the rolling window.
 *
 * Uses two head-only exact-count queries (no rows fetched, so no tokens or
 * PII ever leave the database). Requires a service-role client because the
 * table has RLS enabled with no policies.
 */
export async function computeHandoffHealth(
  supabase: SupabaseClient,
  options: ComputeHandoffHealthOptions = {}
): Promise<{ data: HandoffHealthCounts | null; error: Error | null }> {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const now = options.now ?? Date.now();
  const windowStart = new Date(now - windowMs).toISOString();

  const createdResult = await supabase
    .from("mobile_auth_handoffs")
    .select("*", { count: "exact", head: true })
    .gte("created_at", windowStart);

  if (createdResult.error) {
    return { data: null, error: new Error(createdResult.error.message) };
  }

  const consumedResult = await supabase
    .from("mobile_auth_handoffs")
    .select("*", { count: "exact", head: true })
    .not("consumed_at", "is", null)
    .gte("consumed_at", windowStart);

  if (consumedResult.error) {
    return { data: null, error: new Error(consumedResult.error.message) };
  }

  return {
    data: {
      created: createdResult.count ?? 0,
      consumed: consumedResult.count ?? 0,
      windowStart,
    },
    error: null,
  };
}

// ── Threshold evaluation ───────────────────────────────────────────────────

export interface EvaluateHandoffHealthThresholds {
  /** Minimum created count before the ratio is trusted. */
  floor?: number;
  /** Alert when consumed/created is strictly below this. */
  minConsumeRatio?: number;
}

export interface HandoffHealthVerdict {
  alert: boolean;
  reason: string;
  /** consumed / created, or 0 when nothing was created. */
  ratio: number;
}

/**
 * Pure threshold logic. Alerts only when BOTH hold:
 * - `created >= floor` (enough volume that the ratio is meaningful), AND
 * - `consumed / created < minConsumeRatio` (completion is unhealthily low).
 *
 * This keeps low-volume noise and healthy ratios from firing.
 */
export function evaluateHandoffHealth(
  counts: Pick<HandoffHealthCounts, "created" | "consumed">,
  thresholds: EvaluateHandoffHealthThresholds = {}
): HandoffHealthVerdict {
  const floor = thresholds.floor ?? DEFAULT_FLOOR;
  const minConsumeRatio = thresholds.minConsumeRatio ?? DEFAULT_MIN_CONSUME_RATIO;

  const { created, consumed } = counts;
  const ratio = created > 0 ? consumed / created : 0;

  if (created < floor) {
    return {
      alert: false,
      ratio,
      reason: `below floor (created ${created} < ${floor})`,
    };
  }

  if (ratio < minConsumeRatio) {
    return {
      alert: true,
      ratio,
      reason: `low consume ratio (${consumed}/${created} = ${ratio.toFixed(2)} < ${minConsumeRatio})`,
    };
  }

  return {
    alert: false,
    ratio,
    reason: `healthy (${consumed}/${created} = ${ratio.toFixed(2)} >= ${minConsumeRatio})`,
  };
}
