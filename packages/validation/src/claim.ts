import { z } from "zod";
import { baseSchemas } from "./schemas";

// Claim account — step 1: request OTP code by email.
export const claimEmailSchema = z.object({
  email: baseSchemas.email,
});
export type ClaimEmailForm = z.infer<typeof claimEmailSchema>;

// Claim account — step 2: verify the 8-digit OTP code.
// Code-flow avoids email-link prefetch issues (Apple Mail, scanners) that
// consume single-use magic-link tokens before the user can click them.
// 8 digits matches the project's Auth → Email OTP Length setting.
export const claimOtpSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d{8}$/, "Enter the 8-digit code from your email"),
});
export type ClaimOtpForm = z.infer<typeof claimOtpSchema>;

// Shape returned by the `claim_alumni_profiles` RPC. Validated at the call
// site so a future migration change cannot crash the claim screen with a
// runtime TypeError.
export const claimedOrgRowSchema = z.array(
  z.object({
    out_organization_id: z.string().uuid(),
    out_slug: z.string().min(1),
  }),
);
export type ClaimedOrgRow = z.infer<typeof claimedOrgRowSchema>[number];
