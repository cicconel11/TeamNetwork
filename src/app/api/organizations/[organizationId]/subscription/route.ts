import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe, getPriceIds } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getAlumniLimit, normalizeBucket } from "@/lib/alumni-quota";
import type { AlumniBucket, SubscriptionInterval } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

const fetchQuota = async (client: ReturnType<typeof createServiceClient>, orgId: string) => {
  const rpc = client.rpc as unknown as (
    fn: "get_alumni_quota",
    args: { p_org_id: string }
  ) => Promise<{ data: unknown }>;
  const { data } = await rpc("get_alumni_quota", { p_org_id: orgId });
  return data;
};

async function requireAdmin(orgId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: role } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (role?.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { supabase };
}

function buildQuotaResponse(params: {
  bucket: AlumniBucket;
  alumniLimit: number | null;
  alumniCount: number;
  status: string;
  stripeSubscriptionId: string | null;
}) {
  const remaining = params.alumniLimit === null ? null : Math.max(params.alumniLimit - params.alumniCount, 0);
  return NextResponse.json({
    bucket: params.bucket,
    alumniLimit: params.alumniLimit,
    alumniCount: params.alumniCount,
    remaining,
    status: params.status,
    stripeSubscriptionId: params.stripeSubscriptionId,
  });
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const auth = await requireAdmin(organizationId);
  if ("error" in auth) return auth.error;

  const serviceSupabase = createServiceClient();
  const quotaData = await fetchQuota(serviceSupabase, organizationId);

  const { data: sub } = await serviceSupabase
    .from("organization_subscriptions")
    .select("alumni_bucket, status, base_plan_interval, stripe_subscription_id")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const bucket = normalizeBucket(
    (quotaData as { bucket?: string } | null)?.bucket ??
    (sub?.alumni_bucket as string | null) ??
    "none",
  );
  const alumniLimit = getAlumniLimit(bucket);

  let alumniCount =
    (quotaData as { alumni_count?: number } | null)?.alumni_count ??
    0;
  if (alumniCount === 0) {
    const { count } = await serviceSupabase
      .from("alumni")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("deleted_at", null);
    alumniCount = count ?? 0;
  }

  const status =
    (quotaData as { status?: string } | null)?.status ??
    (sub?.status as string | undefined) ??
    "pending";

  return buildQuotaResponse({
    bucket,
    alumniLimit,
    alumniCount,
    status,
    stripeSubscriptionId: (sub?.stripe_subscription_id as string | null) ?? null,
  });
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const auth = await requireAdmin(organizationId);
  if ("error" in auth) return auth.error;

  let body: { alumniBucket?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!body.alumniBucket) {
    return NextResponse.json({ error: "alumniBucket is required" }, { status: 400 });
  }

  const targetBucket = normalizeBucket(body.alumniBucket);
  if (targetBucket === "1500+") {
    return NextResponse.json(
      { error: "Contact support to manage the 1500+ alumni plan." },
      { status: 400 },
    );
  }

  const serviceSupabase = createServiceClient();
  const { data: sub } = await serviceSupabase
    .from("organization_subscriptions")
    .select("stripe_subscription_id, base_plan_interval, alumni_bucket, status")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!sub?.stripe_subscription_id) {
    return NextResponse.json(
      { error: "No active Stripe subscription found for this organization." },
      { status: 400 },
    );
  }

  const interval: SubscriptionInterval =
    sub?.base_plan_interval === "year" ? "year" : "month";
  const currentBucket = normalizeBucket(sub?.alumni_bucket as string | null);

  if (currentBucket === targetBucket) {
    const quotaData = await fetchQuota(serviceSupabase, organizationId);
    const alumniCount = (quotaData as { alumni_count?: number } | null)?.alumni_count ?? 0;
    const alumniLimit = getAlumniLimit(targetBucket);
    return buildQuotaResponse({
      bucket: targetBucket,
      alumniLimit,
      alumniCount,
      status: (sub?.status as string | undefined) ?? "active",
      stripeSubscriptionId: sub.stripe_subscription_id as string,
    });
  }

  const quotaData = await fetchQuota(serviceSupabase, organizationId);
  const alumniCount = (quotaData as { alumni_count?: number } | null)?.alumni_count ?? 0;

  const targetLimit = getAlumniLimit(targetBucket);
  if (targetLimit !== null && alumniCount > targetLimit) {
    return NextResponse.json(
      { error: "You are above the alumni limit for that plan. Remove alumni or choose a larger bucket." },
      { status: 400 },
    );
  }

  const { basePrice, alumniPrice } = getPriceIds(interval, targetBucket);

  try {
    const subscription = (await stripe.subscriptions.retrieve(sub.stripe_subscription_id, {
      expand: ["items.data.price"],
    })) as Stripe.Subscription;

    const items = subscription.items?.data ?? [];
    const baseItem = items.find((item) => item.price?.id === basePrice) ?? items[0];

    if (!baseItem) {
      return NextResponse.json(
        { error: "Unable to locate base subscription item. Please contact support." },
        { status: 400 },
      );
    }

    const otherItems = items.filter((item) => item.id !== baseItem.id);
    const addOnItem = otherItems.find((item) => item.price?.id !== basePrice) ?? null;
    const preservedItems = otherItems.filter((item) => item.id !== addOnItem?.id);

    const updateItems: Stripe.SubscriptionUpdateParams.Item[] = [
      { id: baseItem.id, price: basePrice, quantity: 1 },
      ...preservedItems
        .filter((item) => item.price?.id)
        .map((item) => ({
          id: item.id,
          price: (item.price?.id as string) ?? undefined,
          quantity: item.quantity ?? 1,
        })),
    ];

    if (alumniPrice) {
      if (addOnItem) {
        updateItems.push({ id: addOnItem.id, price: alumniPrice, quantity: 1 });
      } else {
        updateItems.push({ price: alumniPrice, quantity: 1 });
      }
    } else if (addOnItem) {
      updateItems.push({ id: addOnItem.id, deleted: true });
    }

    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: updateItems,
      metadata: {
        ...(subscription.metadata || {}),
        alumni_bucket: targetBucket,
      },
      proration_behavior: "create_prorations",
    });

    const alumniPlanInterval = targetBucket === "none" ? null : interval;
    await serviceSupabase
      .from("organization_subscriptions")
      .update({
        alumni_bucket: targetBucket,
        alumni_plan_interval: alumniPlanInterval,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId);

    return buildQuotaResponse({
      bucket: targetBucket,
      alumniLimit: targetLimit,
      alumniCount,
      status: (sub?.status as string | undefined) ?? "active",
      stripeSubscriptionId: sub.stripe_subscription_id as string,
    });
  } catch (error) {
    console.error("[subscription-update] Failed to update subscription", error);
    const message = error instanceof Error ? error.message : "Unable to update subscription";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
