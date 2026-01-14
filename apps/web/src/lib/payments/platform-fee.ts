/**
 * Server-side platform fee calculation.
 *
 * SECURITY: Platform fees MUST be calculated server-side to prevent
 * malicious clients from bypassing fees by sending platformFeeAmountCents: 0.
 *
 * This module provides the single source of truth for platform fee calculation.
 */

/**
 * Platform fee percentage (3% = 0.03).
 * This is the fee taken by the platform on each donation.
 */
export const PLATFORM_FEE_PERCENTAGE = 0.03;

/**
 * Calculate the platform fee for a given donation amount.
 *
 * @param amountCents - The donation amount in cents
 * @returns The platform fee in cents, rounded to the nearest cent
 *
 * @example
 * calculatePlatformFee(10000) // $100.00 donation => 300 cents ($3.00 fee)
 * calculatePlatformFee(3333)  // $33.33 donation => 100 cents ($1.00 fee, rounded)
 */
export function calculatePlatformFee(amountCents: number): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return 0;
  }

  return Math.round(amountCents * PLATFORM_FEE_PERCENTAGE);
}
