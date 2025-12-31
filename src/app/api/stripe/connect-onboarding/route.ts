import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let organizationId: string | undefined;
  try {
    const body = await req.json();
    organizationId = body.organizationId;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, slug, stripe_connect_account_id")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgError || !org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("user_organization_roles")
    .select("role, status")
    .eq("organization_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();

  const isAdmin = membership?.role === "admin" && membership.status !== "revoked";
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let accountId = org.stripe_connect_account_id;

  try {
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        metadata: {
          organization_id: org.id,
          organization_slug: org.slug,
          created_by: user.id,
        },
      });
      accountId = account.id;

      await supabase
        .from("organizations")
        .update({ stripe_connect_account_id: accountId })
        .eq("id", org.id);
    }

    const origin = req.headers.get("origin") ?? new URL(req.url).origin;
    const refreshUrl = `${origin}/${org.slug}/philanthropy?onboarding=refresh`;
    const returnUrl = `${origin}/${org.slug}/philanthropy?onboarding=success`;

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    return NextResponse.json({ url: accountLink.url, accountId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start Stripe onboarding";
    console.error("[connect-onboarding] Error:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
