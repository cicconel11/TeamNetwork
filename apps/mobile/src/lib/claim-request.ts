// Age-gate metadata shaping for the alumni-claim OTP request step.
//
// COMPLIANCE (COPPA / minor consent): claim.tsx's request step calls
// `signInWithOtp({ shouldCreateUser: true })`, which mints the `auth.users` row
// for a previously unregistered alumnus. There is NO database age backstop
// (`handle_new_user` ignores age_bracket; no trigger/RLS/CHECK reads it), and
// `signInWithOtp` never touches the web `/auth/callback` age gate. So the age
// metadata MUST be attached here, mirroring signup.tsx, or the account is minted
// age-unvalidated. Extracting the option-shaping keeps that invariant unit-tested.

export type AgeGateResult = {
  ageBracket: "13_17" | "18_plus";
  isMinor: boolean;
  token: string;
};

export type ClaimSignInOptions = {
  captchaToken: string;
  shouldCreateUser: true;
  data: {
    age_bracket: "13_17" | "18_plus";
    is_minor: boolean;
    age_validation_token: string;
  };
};

/**
 * Build the `signInWithOtp` options for the alumni-claim request step.
 *
 * `shouldCreateUser` is intentionally `true` (genuine unregistered alumni have
 * no `auth.users` row yet), so the validated age metadata is required.
 */
export function buildClaimSignInOptions(
  captchaToken: string,
  ageGate: AgeGateResult,
): ClaimSignInOptions {
  return {
    captchaToken,
    shouldCreateUser: true,
    data: {
      age_bracket: ageGate.ageBracket,
      is_minor: ageGate.isMinor,
      age_validation_token: ageGate.token,
    },
  };
}
