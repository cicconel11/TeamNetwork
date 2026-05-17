import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { buildReceiptResponse } from "@/lib/wallet/receipt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Resolves a donation receipt by payment_attempts.id rather than by the
 * organization_donations.id. Used by the mobile donation success screen so
 * the iOS client can offer "Save to Wallet" immediately after the Payment
 * Sheet completes — the donation row is created asynchronously by the
 * Stripe webhook, so this route returns 409 with `{ reason: "pending" }`
 * until the donation lands.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ paymentAttemptId: string }> },
) {
  const { paymentAttemptId: rawId } = await ctx.params;
  const idParse = baseSchemas.uuid.safeParse(rawId);
  if (!idParse.success) {
    return NextResponse.json({ error: "Invalid payment attempt id" }, { status: 400 });
  }
  const paymentAttemptId = idParse.data;

  const rateLimit = checkRateLimit(req, {
    userId: null,
    feature: "wallet donation receipt by attempt",
    limitPerIp: 60,
    limitPerUser: 30,
  });
  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: rateLimit.headers },
    );
  }

  const service = createServiceClient();
  const { data: attempt } = await service
    .from("payment_attempts")
    .select(
      "id, status, stripe_payment_intent_id, organization_id, metadata, flow_type",
    )
    .eq("id", paymentAttemptId)
    .maybeSingle();
  if (!attempt) {
    return NextResponse.json(
      { error: "Payment attempt not found" },
      { status: 404, headers: rateLimit.headers },
    );
  }
  if (!attempt.stripe_payment_intent_id) {
    return NextResponse.json(
      { error: "Receipt not ready yet.", reason: "pending" },
      { status: 409, headers: rateLimit.headers },
    );
  }

  const { data: donation } = await service
    .from("organization_donations")
    .select(
      "id, amount_cents, currency, donor_name, donor_email, purpose, status, created_at, organization_id, anonymous",
    )
    .eq("stripe_payment_intent_id", attempt.stripe_payment_intent_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!donation) {
    return NextResponse.json(
      { error: "Receipt not ready yet.", reason: "pending" },
      { status: 409, headers: rateLimit.headers },
    );
  }
  if (donation.status !== "succeeded") {
    return NextResponse.json(
      { error: "Receipt not ready yet.", reason: "pending" },
      { status: 409, headers: rateLimit.headers },
    );
  }

  // Caller must be the donor (by email) — the only person on a mobile client
  // who could legitimately be polling this. Org admins use the donation-id
  // route. Anonymous donations are not claimable via this endpoint.
  const callerEmail = user.email?.toLowerCase() ?? "";
  const donorEmail = donation.donor_email?.toLowerCase() ?? "";
  if (donation.anonymous || donorEmail === "" || callerEmail !== donorEmail) {
    return NextResponse.json(
      { error: "You can only download receipts for your own donations." },
      { status: 403, headers: rateLimit.headers },
    );
  }

  const { data: org } = await service
    .from("organizations")
    .select("name, slug")
    .eq("id", donation.organization_id)
    .maybeSingle();
  if (!org?.slug || !org?.name) {
    return NextResponse.json(
      { error: "Donation organization missing" },
      { status: 500, headers: rateLimit.headers },
    );
  }

  return buildReceiptResponse({
    donation,
    org,
    rateLimitHeaders: rateLimit.headers,
  });
}
