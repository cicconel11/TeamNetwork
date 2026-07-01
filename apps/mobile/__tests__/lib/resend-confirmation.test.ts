import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/analytics";
import { resendSignupConfirmation } from "@/lib/resend-confirmation";

// The shared Supabase mock (jest.setup.js) does not stub auth.resend, so wire it
// here. Analytics is mocked at the module level to assert captureException.
jest.mock("@/lib/analytics", () => ({
  captureException: jest.fn(),
}));

const mockResend = jest.fn();
(supabase.auth as unknown as { resend: jest.Mock }).resend = mockResend;

// Generic success copy — asserted by the enumeration-guard test below.
const SUCCESS_COPY =
  "If your account needs confirmation, we've sent a new link. Please check your email.";

describe("resendSignupConfirmation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns a success result with generic copy on a clean resend", async () => {
    mockResend.mockResolvedValue({ data: {}, error: null });

    const result = await resendSignupConfirmation("user@example.com", "captcha-token");

    expect(result.status).toBe("success");
    expect(result.message).toBe(SUCCESS_COPY);
    expect(mockResend).toHaveBeenCalledWith({
      type: "signup",
      email: "user@example.com",
      options: { captchaToken: "captcha-token" },
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("passes options: undefined when no captcha token is supplied", async () => {
    mockResend.mockResolvedValue({ data: {}, error: null });

    await resendSignupConfirmation("user@example.com");

    expect(mockResend).toHaveBeenCalledWith({
      type: "signup",
      email: "user@example.com",
      options: undefined,
    });
  });

  it("maps an HTTP 429 error to a rate-limited result", async () => {
    mockResend.mockResolvedValue({
      data: null,
      error: { status: 429, message: "Too many requests" },
    });

    const result = await resendSignupConfirmation("user@example.com", "t");

    expect(result.status).toBe("rate-limited");
    // Rate limiting is an expected condition, not an unexpected error.
    expect(captureException).not.toHaveBeenCalled();
  });

  it("maps a rate-limit error message to a rate-limited result", async () => {
    mockResend.mockResolvedValue({
      data: null,
      error: { message: "email rate limit exceeded" },
    });

    const result = await resendSignupConfirmation("user@example.com", "t");

    expect(result.status).toBe("rate-limited");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns an error result and reports unexpected Supabase errors", async () => {
    mockResend.mockResolvedValue({
      data: null,
      error: { status: 500, message: "internal error" },
    });

    const result = await resendSignupConfirmation("user@example.com", "t");

    expect(result.status).toBe("error");
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("returns an error result and reports a thrown/rejected resend", async () => {
    mockResend.mockRejectedValue(new Error("network down"));

    const result = await resendSignupConfirmation("user@example.com", "t");

    expect(result.status).toBe("error");
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("does not leak whether the email exists (enumeration guard)", async () => {
    // Success copy must be identical regardless of the email supplied, so it
    // cannot be used to probe which addresses have accounts.
    mockResend.mockResolvedValue({ data: {}, error: null });

    const known = await resendSignupConfirmation("real-account@example.com", "t");
    const unknown = await resendSignupConfirmation("not-a-user@example.com", "t");

    expect(known.message).toBe(unknown.message);
    expect(known.message).toBe(SUCCESS_COPY);
    // Copy is conditional ("If your account needs confirmation...") — it must
    // never unconditionally affirm that the account exists / was confirmed, and
    // must not echo the caller's email address back.
    expect(known.message.startsWith("If ")).toBe(true);
    expect(known.message).not.toMatch(/account (exists|is confirmed|was found)/i);
    expect(known.message).not.toMatch(/real-account@example\.com/);
    expect(unknown.message).not.toMatch(/not-a-user@example\.com/);
  });
});
