import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgContext } from "@/lib/auth/roles";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getAuthorizationUrl, isBlackbaudConfigured } from "@/lib/blackbaud/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isBlackbaudConfigured()) {
    return NextResponse.json(
      { error: "Blackbaud integration is not configured in this environment" },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "blackbaud-auth",
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
    return NextResponse.json({ error: "Not an admin of this organization" }, { status: 403, headers: rateLimit.headers });
  }

  const serviceSupabase = createServiceClient();
  const { data: oauthState, error: insertError } = await (serviceSupabase as any)
    .from("org_integration_oauth_state")
    .insert({
      organization_id: orgContext.organization.id,
      provider: "blackbaud",
      user_id: user.id,
      redirect_path: `/${orgSlug}/settings/integrations`,
    })
    .select("id")
    .single() as { data: { id: string } | null; error: any };

  if (insertError || !oauthState) {
    console.error("[blackbaud-auth] Failed to create OAuth state:", insertError);
    return NextResponse.json({ error: "Failed to initiate connection" }, { status: 500, headers: rateLimit.headers });
  }

  return NextResponse.redirect(getAuthorizationUrl(oauthState.id));
}
