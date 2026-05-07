/* 
  Backfill a Stripe subscription into Supabase for an existing organization.

  Usage:
    SUPABASE_URL=... \
    SUPABASE_SERVICE_ROLE_KEY=... \
    STRIPE_SECRET_KEY=... \
    node scripts/backfill-stripe-subscription.js <organization_id> <stripe_subscription_id>

  What it does:
    - Fetches the Stripe subscription (expanded with items/prices)
    - Derives customer id, base interval, and alumni bucket from price ids
    - Updates public.organization_subscriptions with stripe_subscription_id, stripe_customer_id,
      base_plan_interval, alumni_bucket, and alumni_plan_interval
*/

const { createClient } = require("@supabase/supabase-js");
const { stripe: stripeClient, getPriceIds } = require("../src/lib/stripe");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

async function main() {
  const [orgId, subId] = process.argv.slice(2);
  if (!orgId || !subId) {
    console.error("Usage: node scripts/backfill-stripe-subscription.js <organization_id> <stripe_subscription_id>");
    process.exit(1);
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`🔄 Backfilling subscription ${subId} for org ${orgId}...`);

  const intervals = ["month", "year"];
  const buckets = ["none", "0-200", "201-600", "601-1500"];
  const priceMap = [];

  intervals.forEach((interval) => {
    buckets.forEach((bucket) => {
      const { basePrice, alumniPrice } = getPriceIds(interval, bucket);
      priceMap.push({ priceId: basePrice, bucket, interval, type: "base" });
      if (alumniPrice) {
        priceMap.push({ priceId: alumniPrice, bucket, interval, type: "alumni" });
      }
    });
  });

  const subscription = await stripeClient.subscriptions.retrieve(subId, {
    expand: ["items.data.price"],
  });

  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer?.id || null;

  let detectedBucket = "none";
  let detectedInterval = "month";

  for (const item of subscription.items?.data || []) {
    const priceId = item.price?.id;
    if (!priceId) continue;
    const match = priceMap.find((p) => p.priceId === priceId && p.type === "alumni");
    const baseMatch = priceMap.find((p) => p.priceId === priceId && p.type === "base");
    if (match) {
      detectedBucket = match.bucket;
      detectedInterval = match.interval;
    } else if (baseMatch) {
      detectedInterval = baseMatch.interval;
    }
  }

  const alumniPlanInterval = detectedBucket === "none" ? null : detectedInterval;

  console.log("➡️  Derived:", {
    customerId,
    bucket: detectedBucket,
    interval: detectedInterval,
    alumniPlanInterval,
  });

  const { error } = await supabase
    .from("organization_subscriptions")
    .upsert(
      {
        organization_id: orgId,
        stripe_subscription_id: subId,
        stripe_customer_id: customerId,
        base_plan_interval: detectedInterval,
        alumni_bucket: detectedBucket,
        alumni_plan_interval: alumniPlanInterval,
        status: subscription.status || "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    );

  if (error) {
    console.error("❌ Failed to update organization_subscriptions:", error);
    process.exit(1);
  }

  console.log("✅ Backfill complete. Refresh the Invites page and try Update plan / Billing portal again.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
