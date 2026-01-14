import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const onboardingSchema = z
  .object({
    organizationId: baseSchemas.uuid,
    idempotencyKey: baseSchemas.idempotencyKey.optional(),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "Stripe onboarding",
      limitPerIp: 30,
      limitPerUser: 20,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (!user) {
      return respond({ error: "Unauthorized" }, 401);
    }

    const { organizationId, idempotencyKey } = await validateJson(req, onboardingSchema);

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id, slug, stripe_connect_account_id")
      .eq("id", organizationId)
      .maybeSingle();

    if (orgError || !org) {
      return respond({ error: "Organization not found" }, 404);
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role, status")
      .eq("organization_id", org.id)
      .eq("user_id", user.id)
      .maybeSingle();

    const isAdmin = membership?.role === "admin" && membership.status !== "revoked";
    if (!isAdmin) {
      return respond({ error: "Forbidden" }, 403);
    }

    // Block mutations if org is in grace period (read-only mode)
    const { isReadOnly } = await checkOrgReadOnly(org.id);
    if (isReadOnly) {
      return respond(readOnlyResponse(), 403);
    }

    let accountId = org.stripe_connect_account_id;

    try {
      if (!accountId) {
        const accountKey = idempotencyKey || `connect-account-${org.id}-${user.id}`;
        const account = await stripe.accounts.create({
          type: "express",
          metadata: {
            organization_id: org.id,
            organization_slug: org.slug,
            created_by: user.id,
          },
        }, { idempotencyKey: accountKey });
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
      }, idempotencyKey ? { idempotencyKey } : undefined);

      return respond({ url: accountLink.url, accountId, idempotencyKey: idempotencyKey || null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start Stripe onboarding";
      console.error("[connect-onboarding] Error:", message);
      return respond({ error: message }, 400);
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
