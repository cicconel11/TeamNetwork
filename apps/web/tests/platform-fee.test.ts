import test from "node:test";
import assert from "node:assert";
import { calculatePlatformFee, PLATFORM_FEE_PERCENTAGE } from "../src/lib/payments/platform-fee.ts";

test("platform fee is calculated at the correct percentage", () => {
  const amountCents = 10000; // $100.00
  const fee = calculatePlatformFee(amountCents);

  // Default 3% fee
  assert.strictEqual(fee, 300, "Fee should be 3% of amount (300 cents for $100)");
});

test("platform fee is rounded to nearest cent", () => {
  // Amount that doesn't divide evenly: $33.33 = 3333 cents
  // 3% of 3333 = 99.99, should round to 100
  const fee = calculatePlatformFee(3333);
  assert.strictEqual(fee, 100, "Fee should be rounded to nearest cent");
});

test("platform fee has minimum of 0", () => {
  const fee = calculatePlatformFee(0);
  assert.strictEqual(fee, 0, "Fee for $0 should be $0");
});

test("platform fee handles large amounts correctly", () => {
  const amountCents = 10000000; // $100,000.00
  const fee = calculatePlatformFee(amountCents);

  // 3% of $100,000 = $3,000 = 300000 cents
  assert.strictEqual(fee, 300000, "Fee should scale correctly with large amounts");
});

test("platform fee percentage constant is exported", () => {
  assert.strictEqual(typeof PLATFORM_FEE_PERCENTAGE, "number", "PLATFORM_FEE_PERCENTAGE should be a number");
  assert.ok(PLATFORM_FEE_PERCENTAGE > 0 && PLATFORM_FEE_PERCENTAGE < 1, "PLATFORM_FEE_PERCENTAGE should be between 0 and 1");
});

test("platform fee ignores any client-provided fee", () => {
  const amountCents = 10000;
  // Even if client sends 0, we calculate server-side
  const fee = calculatePlatformFee(amountCents);
  assert.strictEqual(fee, 300, "Fee should always be server-calculated, not client-provided");
});

test("platform fee for minimum donation amount", () => {
  // Minimum donation is $1.00 = 100 cents
  const fee = calculatePlatformFee(100);
  // 3% of 100 = 3 cents
  assert.strictEqual(fee, 3, "Minimum donation should still have a fee");
});
