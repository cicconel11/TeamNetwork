import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgContext } from "@/lib/auth/roles";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "blackbaud-disconnect",
    limitPerIp: 10,
    limitPerUser: 5,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
  }

  const url = new URL(req.url);
  const orgSlug = url.searchParams.get("orgSlug");
  if (!orgSlug) {
    return NextResponse.json({ error: "Missing orgSlug" }, { status: 400, headers: rateLimit.headers });
  }

  const orgContext = await getOrgContext(orgSlug);
  if (!orgContext || !orgContext.isAdmin || !orgContext.organization) {
    return NextResponse.json({ error: "Not an admin" }, { status: 403, headers: rateLimit.headers });
  }

  const serviceSupabase = createServiceClient();
  const { error, count } = (await (serviceSupabase as any)
    .from("org_integrations")
    .update({
      status: "disconnected",
      access_token_enc: null,
      refresh_token_enc: null,
      token_expires_at: null,
      last_sync_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", orgContext.organization.id)
    .eq("provider", "blackbaud")
    .select("id", { count: "exact", head: true })) as { error: any; count: number };

  if (error) {
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500, headers: rateLimit.headers });
  }

  if (count === 0) {
    return NextResponse.json({ error: "No Blackbaud connection found" }, { status: 404, headers: rateLimit.headers });
  }

  return NextResponse.json({ success: true }, { headers: rateLimit.headers });
}
