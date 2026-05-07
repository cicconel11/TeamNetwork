import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/app/api/stripe/webhook/handler.ts"), "utf8");
const enterpriseV2Block = source.slice(
  source.indexOf('if (session.metadata?.type === "enterprise_v2")'),
  source.indexOf('// v2 dynamic-quote test slice'),
);

describe("stripe webhook enterprise_v2 security", () => {
  it("resolves enterprise owner from payment_attempts, not creator_id metadata", () => {
    assert.match(enterpriseV2Block, /resolveCreatorFromPaymentAttempt\(v2AttemptId\)/);
    assert.doesNotMatch(enterpriseV2Block, /metadata\?\.creator_id/);
    assert.match(enterpriseV2Block, /user_id: ownerUserId/);
  });

  it("retrieves Stripe subscription status and current period end", () => {
    assert.match(enterpriseV2Block, /stripeClient\.subscriptions\.retrieve\(subscriptionId\)/);
    assert.match(enterpriseV2Block, /enterpriseStatus = normalizeSubscriptionStatus\(subscription\)/);
    assert.match(enterpriseV2Block, /enterprisePeriodEnd = extractSubscriptionPeriodEndIso\(subscription\)/);
    assert.match(enterpriseV2Block, /status: enterpriseStatus/);
    assert.match(enterpriseV2Block, /current_period_end: enterprisePeriodEnd/);
  });
});
