import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/analytics";
import { requestLoginCode, verifyLoginCode } from "@/lib/otp-signin";
import { buildClaimSignInOptions } from "@/lib/claim-request";

jest.mock("@/lib/analytics", () => ({
  captureException: jest.fn(),
  track: jest.fn(),
}));

// The base jest.setup mock does not define OTP auth methods; add them here so
// each test controls the resolved value.
const signInWithOtp = jest.fn();
const verifyOtp = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (supabase.auth as unknown as Record<string, unknown>).signInWithOtp =
    signInWithOtp;
  (supabase.auth as unknown as Record<string, unknown>).verifyOtp = verifyOtp;
  signInWithOtp.mockResolvedValue({ data: {}, error: null });
  verifyOtp.mockResolvedValue({ data: {}, error: null });
});

describe("requestLoginCode (login-only OTP)", () => {
  it("calls signInWithOtp with shouldCreateUser:false and the captcha token", async () => {
    // CRITICAL security guard: this path must NEVER create an account.
    const result = await requestLoginCode("user@example.com", "captcha-123");

    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "user@example.com",
      options: {
        captchaToken: "captcha-123",
        shouldCreateUser: false,
      },
    });
    expect(result).toEqual({
      kind: "sent",
      message: expect.stringContaining("8-digit code"),
    });
  });

  it("returns the generic 'sent' result for an unknown email (enumeration-safe)", async () => {
    // shouldCreateUser:false → Supabase reports the account does not exist.
    signInWithOtp.mockResolvedValue({
      data: {},
      error: { message: "Signups not allowed for otp", status: 422 },
    });

    const result = await requestLoginCode("nobody@example.com", "captcha-123");

    // Identical to the happy-path result: no "no account found" oracle.
    expect(result).toEqual({
      kind: "sent",
      message: expect.stringContaining("If your email is on file"),
    });
    // No session is set and no unexpected error is captured.
    expect(supabase.auth.setSession).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("maps a 429 to a rate-limited result", async () => {
    signInWithOtp.mockResolvedValue({
      data: {},
      error: { message: "rate limit exceeded", status: 429 },
    });

    const result = await requestLoginCode("user@example.com", "captcha-123");

    expect(result.kind).toBe("rate-limited");
  });
});

describe("verifyLoginCode (login-only OTP)", () => {
  it("returns success on a valid code and does NOT call the claim RPC", async () => {
    const result = await verifyLoginCode("user@example.com", "12345678");

    expect(verifyOtp).toHaveBeenCalledWith({
      email: "user@example.com",
      token: "12345678",
      type: "email",
    });
    expect(result).toEqual({ kind: "success" });
    // Login OTP must not run the alumni-claim RPC.
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("returns a re-requestable invalid-code result for a bad/expired code", async () => {
    verifyOtp.mockResolvedValue({
      data: {},
      error: { message: "Token has expired or is invalid" },
    });

    const result = await verifyLoginCode("user@example.com", "00000000");

    expect(result).toEqual({
      kind: "invalid-code",
      message: expect.stringContaining("didn't work"),
    });
    // Expected user-input error — not captured as a system exception.
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("buildClaimSignInOptions (age-gate metadata for alumni claim)", () => {
  it("attaches age metadata to the shouldCreateUser:true claim request", () => {
    // COMPLIANCE guard: claim.tsx mints an auth.users row via
    // shouldCreateUser:true, so it MUST carry age metadata (no DB backstop).
    const options = buildClaimSignInOptions("captcha-abc", {
      ageBracket: "18_plus",
      isMinor: false,
      token: "age-token-xyz",
    });

    expect(options).toEqual({
      captchaToken: "captcha-abc",
      shouldCreateUser: true,
      data: {
        age_bracket: "18_plus",
        is_minor: false,
        age_validation_token: "age-token-xyz",
      },
    });
  });

  it("propagates the minor flag and 13_17 bracket", () => {
    const options = buildClaimSignInOptions("captcha-abc", {
      ageBracket: "13_17",
      isMinor: true,
      token: "age-token-teen",
    });

    expect(options.data).toEqual({
      age_bracket: "13_17",
      is_minor: true,
      age_validation_token: "age-token-teen",
    });
    expect(options.shouldCreateUser).toBe(true);
  });
});
