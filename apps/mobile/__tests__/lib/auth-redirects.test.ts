import {
  buildMobileEmailSignupCallbackUrl,
  buildMobileGoogleAuthUrl,
  buildMobileOAuthUrl,
  buildMobileRecoveryRedirectTo,
  parseMobileAuthCallbackUrl,
} from "../../src/lib/auth-redirects";

describe("buildMobileRecoveryRedirectTo", () => {
  it("routes password recovery through the web auth callback instead of the custom scheme", () => {
    const redirectTo = buildMobileRecoveryRedirectTo(
      "https://www.myteamnetwork.com",
      "/auth/login"
    );

    expect(redirectTo).toBe(
      "https://www.myteamnetwork.com/auth/callback?redirect=%2Fauth%2Freset-password%3Fredirect%3D%252Fauth%252Flogin"
    );
    expect(redirectTo).not.toContain("teammeet://reset-password");
  });
});

describe("mobile Google auth redirects", () => {
  it("starts Google login through the web-owned mobile route", () => {
    const url = buildMobileGoogleAuthUrl("https://www.myteamnetwork.com", {
      mode: "login",
    });

    expect(url).toBe("https://www.myteamnetwork.com/auth/mobile/google?mode=login&redirect=%2Fapp");
    expect(url).not.toContain("supabase.co");
  });

  it("passes signup age data to the web mobile start route", () => {
    const url = buildMobileGoogleAuthUrl("https://www.myteamnetwork.com/", {
      mode: "signup",
      ageBracket: "13_17",
      isMinor: true,
      ageToken: "age-token",
    });
    const parsed = new URL(url);

    expect(parsed.pathname).toBe("/auth/mobile/google");
    expect(parsed.searchParams.get("mode")).toBe("signup");
    expect(parsed.searchParams.get("age_bracket")).toBe("13_17");
    expect(parsed.searchParams.get("is_minor")).toBe("true");
    expect(parsed.searchParams.get("age_token")).toBe("age-token");
  });

  it("routes email signup confirmations through the web mobile callback", () => {
    expect(buildMobileEmailSignupCallbackUrl("https://www.myteamnetwork.com")).toBe(
      "https://www.myteamnetwork.com/auth/callback?mobile=1&mode=signup&redirect=%2Fapp"
    );
  });

  it("parses one-time handoff callbacks", () => {
    expect(parseMobileAuthCallbackUrl("teammeet://callback?handoff_code=abc123")).toEqual({
      type: "handoff",
      code: "abc123",
    });
  });

  it("keeps raw native-scheme tokens ignored", () => {
    expect(
      parseMobileAuthCallbackUrl("teammeet://callback#access_token=raw&refresh_token=raw")
    ).toEqual({ type: "ignored" });
  });

  it("parses error deep links with descriptions", () => {
    expect(
      parseMobileAuthCallbackUrl(
        "teammeet://callback?error=oauth_start_failed&error_description=Could+not+start+sign+in"
      )
    ).toEqual({
      type: "error",
      message: "Could not start sign in",
    });
  });

  it("falls back to error code when description is missing", () => {
    expect(parseMobileAuthCallbackUrl("teammeet://callback?error=access_denied")).toEqual({
      type: "error",
      message: "access_denied",
    });
  });
});

describe("buildMobileOAuthUrl", () => {
  it("starts LinkedIn login through the web-owned mobile route", () => {
    const url = buildMobileOAuthUrl("linkedin", "https://www.myteamnetwork.com", {
      mode: "login",
    });

    expect(url).toBe(
      "https://www.myteamnetwork.com/auth/mobile/linkedin?mode=login&redirect=%2Fapp"
    );
  });

  it("starts Microsoft login through the web-owned mobile route", () => {
    const url = buildMobileOAuthUrl("microsoft", "https://www.myteamnetwork.com", {
      mode: "login",
    });

    expect(url).toBe(
      "https://www.myteamnetwork.com/auth/mobile/microsoft?mode=login&redirect=%2Fapp"
    );
  });

  it("forwards age signup params for any provider", () => {
    const url = buildMobileOAuthUrl("linkedin", "https://www.myteamnetwork.com/", {
      mode: "signup",
      ageBracket: "13_17",
      isMinor: true,
      ageToken: "age-token",
    });
    const parsed = new URL(url);

    expect(parsed.pathname).toBe("/auth/mobile/linkedin");
    expect(parsed.searchParams.get("mode")).toBe("signup");
    expect(parsed.searchParams.get("age_bracket")).toBe("13_17");
    expect(parsed.searchParams.get("is_minor")).toBe("true");
    expect(parsed.searchParams.get("age_token")).toBe("age-token");
  });

  it("buildMobileGoogleAuthUrl is preserved as a backward-compat wrapper", () => {
    expect(buildMobileGoogleAuthUrl("https://www.myteamnetwork.com", { mode: "login" })).toBe(
      buildMobileOAuthUrl("google", "https://www.myteamnetwork.com", { mode: "login" })
    );
  });
});
