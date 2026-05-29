import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { isApifyConfigured, startApifyProfileRun } from "@/lib/linkedin/apify";
import { recordRunTargets } from "@/lib/linkedin/enrichment-writeback";
import { normalizeLinkedInProfileUrl } from "@/lib/alumni/linkedin-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Apify accepts many URLs per run; chunk so a single run isn't unbounded.
const URLS_PER_RUN = 100;

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

type RunTarget =
  | { kind: "alumni"; alumniId: string; organizationId: string; linkedinUrl: string }
  | { kind: "user"; userId: string; linkedinUrl: string };

function safeNormalize(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return normalizeLinkedInProfileUrl(url);
  } catch {
    return null;
  }
}

async function requireAdmin(req: Request, organizationId: string) {
  const { user } = await createAuthenticatedApiClient(req);
  if (!user) return { ok: false as const, status: 401, error: "Unauthorized" };

  const serviceSupabase = createServiceClient();
  const { data: roleData } = await serviceSupabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (roleData?.role !== "admin") {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }
  return { ok: true as const, serviceSupabase, userId: user.id };
}

/**
 * GET /api/organizations/[organizationId]/linkedin/bulk-sync
 *
 * Org-level enrichment progress: counts of alumni rows by enrichment_status.
 * Used to poll progress after a bulk sync is kicked off.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const auth = await requireAdmin(req, organizationId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (auth.serviceSupabase as any)
    .from("alumni")
    .select("enrichment_status")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .not("linkedin_url", "is", null);

  if (error) {
    console.error("[linkedin/bulk-sync GET] count error:", error);
    return NextResponse.json({ error: "Failed to load progress" }, { status: 500 });
  }

  const counts = { pending: 0, syncing: 0, enriched: 0, failed: 0, none: 0 };
  for (const row of (data ?? []) as Array<{ enrichment_status: string | null }>) {
    const s = row.enrichment_status;
    if (s === "pending") counts.pending += 1;
    else if (s === "syncing") counts.syncing += 1;
    else if (s === "enriched") counts.enriched += 1;
    else if (s === "failed") counts.failed += 1;
    else counts.none += 1;
  }

  return NextResponse.json({ counts });
}

/**
 * POST /api/organizations/[organizationId]/linkedin/bulk-sync
 *
 * Admin action: enrich every org member, alumni, and parent that already has a
 * LinkedIn URL. Starts chunked Apify runs (async) — results land via the
 * apify-webhook, matched back to each row by normalized URL. Does NOT count
 * against per-user manual quotas.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const rateLimit = checkRateLimit(req, {
    feature: "linkedin bulk sync",
    limitPerIp: 10,
    limitPerUser: 5,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const auth = await requireAdmin(req, organizationId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: rateLimit.headers });
  }
  const supabase = auth.serviceSupabase;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!isApifyConfigured()) {
    return respond({ error: "LinkedIn sync is not configured in this environment." }, 503);
  }

  // Collect targets keyed by normalized URL so a single Apify run scrapes each
  // URL once, while every row sharing that URL still gets written back.
  const urlToTargets = new Map<string, RunTarget[]>();
  const addTarget = (url: string | null | undefined, target: RunTarget) => {
    const normalized = safeNormalize(url);
    if (!normalized) return;
    const list = urlToTargets.get(normalized);
    if (list) list.push(target);
    else urlToTargets.set(normalized, [target]);
  };

  const [alumniRes, membersRes, parentsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("alumni")
      .select("id, linkedin_url")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .not("linkedin_url", "is", null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("members")
      .select("user_id, linkedin_url")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .not("linkedin_url", "is", null)
      .not("user_id", "is", null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("parents")
      .select("user_id, linkedin_url")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .not("linkedin_url", "is", null)
      .not("user_id", "is", null),
  ]);

  if (alumniRes.error || membersRes.error || parentsRes.error) {
    console.error("[linkedin/bulk-sync POST] load error:", alumniRes.error ?? membersRes.error ?? parentsRes.error);
    return respond({ error: "Failed to load organization records" }, 500);
  }

  for (const row of (alumniRes.data ?? []) as Array<{ id: string; linkedin_url: string }>) {
    addTarget(row.linkedin_url, {
      kind: "alumni",
      alumniId: row.id,
      organizationId,
      linkedinUrl: row.linkedin_url,
    });
  }
  for (const row of (membersRes.data ?? []) as Array<{ user_id: string; linkedin_url: string }>) {
    addTarget(row.linkedin_url, { kind: "user", userId: row.user_id, linkedinUrl: row.linkedin_url });
  }
  for (const row of (parentsRes.data ?? []) as Array<{ user_id: string; linkedin_url: string }>) {
    addTarget(row.linkedin_url, { kind: "user", userId: row.user_id, linkedinUrl: row.linkedin_url });
  }

  const uniqueUrls = Array.from(urlToTargets.keys());
  if (uniqueUrls.length === 0) {
    return respond({ runs_started: 0, queued_urls: 0, alumni: 0, users: 0, message: "No LinkedIn URLs to sync." });
  }

  let runsStarted = 0;
  let queuedUrls = 0;
  let failedUrls = 0;
  let alumniQueued = 0;
  let usersQueued = 0;

  for (let i = 0; i < uniqueUrls.length; i += URLS_PER_RUN) {
    const chunkUrls = uniqueUrls.slice(i, i + URLS_PER_RUN);
    const start = await startApifyProfileRun(chunkUrls);
    if (!start.ok) {
      console.error("[linkedin/bulk-sync POST] run start failed:", start.kind, start.error);
      failedUrls += chunkUrls.length;
      continue;
    }

    const chunkTargets = chunkUrls.flatMap((url) => urlToTargets.get(url) ?? []);
    await recordRunTargets(supabase, start.runId, chunkTargets);

    // Reflect "syncing" on the alumni rows so the directory shows progress.
    const alumniIds = chunkTargets
      .filter((t): t is Extract<RunTarget, { kind: "alumni" }> => t.kind === "alumni")
      .map((t) => t.alumniId);
    if (alumniIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("alumni")
        .update({ enrichment_status: "syncing", enrichment_snapshot_id: start.runId, enrichment_error: null })
        .in("id", alumniIds);
      alumniQueued += alumniIds.length;
    }
    usersQueued += chunkTargets.filter((t) => t.kind === "user").length;

    runsStarted += 1;
    queuedUrls += chunkUrls.length;
  }

  return respond({
    runs_started: runsStarted,
    queued_urls: queuedUrls,
    failed_urls: failedUrls,
    alumni: alumniQueued,
    users: usersQueued,
    message: `Started ${runsStarted} sync run(s) for ${queuedUrls} LinkedIn profile(s).`,
  });
}
