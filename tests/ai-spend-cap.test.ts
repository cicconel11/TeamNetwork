import test from "node:test";
import assert from "node:assert/strict";
import {
  AiCapReachedError,
  isAiSpendBypassed,
  priceTokensMicrousd,
  type SpendStatus,
} from "@/lib/ai/spend";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

test("priceTokensMicrousd: glm-5.1 priced from env (input + output)", () => {
  resetEnv();
  process.env.AI_PRICE_GLM_5_1_INPUT_PER_MTOK = "600";   // $6 / Mtok input
  process.env.AI_PRICE_GLM_5_1_OUTPUT_PER_MTOK = "2200"; // $22 / Mtok output
  // 1000 input + 500 output = 6 + 11 = 17 cents = 170_000 microUSD
  const microusd = priceTokensMicrousd("glm-5.1", 1000, 500);
  assert.equal(microusd, 1000 * 6 + 500 * 22);
});

test("priceTokensMicrousd: glm-5v vision-only env", () => {
  resetEnv();
  process.env.AI_PRICE_GLM_5V_INPUT_PER_MTOK = "2000";
  process.env.AI_PRICE_GLM_5V_OUTPUT_PER_MTOK = "6000";
  const micro = priceTokensMicrousd("glm-5v-turbo", 1000, 1000);
  assert.equal(micro, 1000 * 20 + 1000 * 60);
});

test("priceTokensMicrousd: gemini embedding has output_per_mtok=0", () => {
  resetEnv();
  process.env.AI_PRICE_GEMINI_EMBED_PER_MTOK = "150";
  const micro = priceTokensMicrousd("gemini-embedding-001", 10_000, 0);
  // 10_000 * 1.5 = 15_000 microUSD = 1.5 cents
  assert.equal(micro, 15_000);
});

test("priceTokensMicrousd: throws when model has no env entry", () => {
  resetEnv();
  delete process.env.AI_PRICE_GLM_5_1_INPUT_PER_MTOK;
  delete process.env.AI_PRICE_GLM_5_1_OUTPUT_PER_MTOK;
  delete process.env.AI_PRICE_GLM_5V_INPUT_PER_MTOK;
  delete process.env.AI_PRICE_GLM_5V_OUTPUT_PER_MTOK;
  delete process.env.AI_PRICE_GEMINI_EMBED_PER_MTOK;
  assert.throws(
    () => priceTokensMicrousd("totally-unknown-model", 100, 100),
    /no price configured/,
  );
});

test("AiCapReachedError.toResponse: 402 JSON with status fields", async () => {
  const status: SpendStatus = {
    allowed: false,
    spendCents: 2237,
    capCents: 2200,
    percentUsed: 100,
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30T23:59:59.999Z",
  };
  const err = new AiCapReachedError(status);
  const res = err.toResponse();
  assert.equal(res.status, 402);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.error, "ai_monthly_cap_reached");
  assert.equal(body.currentCents, 2237);
  assert.equal(body.capCents, 2200);
  assert.equal(body.periodEnd, "2026-04-30T23:59:59.999Z");
});

test("isAiSpendBypassed: true for DEV_ADMIN_EMAILS, false otherwise", () => {
  resetEnv();
  process.env.DEV_ADMIN_EMAILS = "dev@example.com,owner@team.io";
  assert.equal(isAiSpendBypassed({ email: "dev@example.com" }), true);
  assert.equal(isAiSpendBypassed({ email: "DEV@example.com" }), true);
  assert.equal(isAiSpendBypassed({ email: "owner@team.io" }), true);
  assert.equal(isAiSpendBypassed({ email: "user@example.com" }), false);
  assert.equal(isAiSpendBypassed(null), false);
  assert.equal(isAiSpendBypassed(undefined), false);
  assert.equal(isAiSpendBypassed({ email: null }), false);
});

test("AiCapReachedError carries original status", () => {
  const status: SpendStatus = {
    allowed: false,
    spendCents: 2200,
    capCents: 2200,
    percentUsed: 100,
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30T23:59:59.999Z",
  };
  const err = new AiCapReachedError(status);
  assert.equal(err.message, "ai_monthly_cap_reached");
  assert.equal(err.status.spendCents, 2200);
  assert.equal(err.name, "AiCapReachedError");
});
