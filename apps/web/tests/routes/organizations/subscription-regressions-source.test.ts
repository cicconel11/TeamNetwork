import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function squishWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

test("subscription GET responds with backfilled currentPeriodEnd on the same request", () => {
  const source = readSource("src/app/api/organizations/[organizationId]/subscription/route.ts");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes(
      "const resolvedCurrentPeriodEnd = planDetails.currentPeriodEnd ?? (sub?.current_period_end as string | null) ?? null;"
    ),
    "subscription GET must prefer the just-backfilled period end over the stale row value"
  );
  assert.ok(
    normalized.includes("currentPeriodEnd: resolvedCurrentPeriodEnd,"),
    "subscription GET response must use the resolved period end"
  );
  assert.ok(
    normalized.includes("const currentPeriodEnd = extractSubscriptionPeriodEndIso(updatedSubscription"),
    "subscription updates must reuse the extracted period end from Stripe"
  );
  assert.ok(
    normalized.includes("current_period_end: currentPeriodEnd,"),
    "subscription updates must persist current_period_end when Stripe returns it"
  );
});

test("reconcile-subscription authorizes org admins through the service-role membership lookup", () => {
  const source = readSource("src/app/api/organizations/[organizationId]/reconcile-subscription/route.ts");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes("membership = await getOrgMembership(serviceSupabase as never, user.id, organizationId);"),
    "reconcile-subscription must load org membership through the service client"
  );
  assert.ok(
    normalized.includes('return respond({ error: "Unable to verify permissions" }, 500);'),
    "reconcile-subscription must fail closed when permission lookup errors"
  );
  assert.strictEqual(
    source.includes('supabase\n    .from("user_organization_roles")'),
    false,
    "reconcile-subscription must not rely on the SSR client for org role lookups"
  );
});
