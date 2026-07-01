/**
 * Deep-link parser tests.
 *
 * Pure-function tests for `parseTeammeetUrl`. `routeIntent` has side effects
 * (Supabase, router) and is integration-tested manually via the dev client.
 */

jest.mock("expo-linking", () => ({
  parse: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: jest.fn(),
      setSession: jest.fn(),
    },
  },
}));

jest.mock("@/lib/mobile-auth", () => ({
  consumeMobileAuthHandoff: jest.fn(),
}));

jest.mock("@/lib/analytics", () => ({
  captureException: jest.fn(),
}));

jest.mock("@/lib/mobile-auth-errors", () => ({
  surfaceMobileAuthError: jest.fn(),
}));

jest.mock("@/components/ui/Toast", () => ({
  showToast: jest.fn(),
}));

jest.mock("@teammeet/validation", () => ({
  baseSchemas: {
    email: { safeParse: () => ({ success: true }) },
  },
}));

import { parseTeammeetUrl, routeIntent } from "@/lib/deep-link";
import { consumeMobileAuthHandoff } from "@/lib/mobile-auth";
import { surfaceMobileAuthError } from "@/lib/mobile-auth-errors";
import { showToast } from "@/components/ui/Toast";
import { captureException } from "@/lib/analytics";

describe("parseTeammeetUrl", () => {
  describe("auth (native scheme)", () => {
    it("parses handoff codes", () => {
      const intent = parseTeammeetUrl("teammeet://callback?handoff_code=abc123");
      expect(intent).toEqual({ kind: "auth-handoff", code: "abc123" });
    });

    it("parses error callbacks with description (code preserved separately from raw message)", () => {
      const intent = parseTeammeetUrl(
        "teammeet://callback?error=access_denied&error_description=User%20cancelled"
      );
      // errorCode drives the app-owned copy; rawMessage is Sentry-only, never rendered.
      expect(intent).toEqual({
        kind: "auth-error",
        errorCode: "access_denied",
        rawMessage: "User cancelled",
      });
    });

    it("parses error callbacks without description (rawMessage falls back to the code)", () => {
      const intent = parseTeammeetUrl("teammeet://callback?error=access_denied");
      expect(intent).toEqual({
        kind: "auth-error",
        errorCode: "access_denied",
        rawMessage: "access_denied",
      });
    });

    it("rejects raw access tokens on the native scheme (session-fixation defense)", () => {
      const intent = parseTeammeetUrl(
        "teammeet://callback#access_token=raw&refresh_token=also_raw"
      );
      expect(intent.kind).toBe("ignored");
    });
  });

  describe("auth (trusted web hosts)", () => {
    const orig = process.env.EXPO_PUBLIC_SUPABASE_URL;
    beforeAll(() => {
      process.env.EXPO_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    });
    afterAll(() => {
      process.env.EXPO_PUBLIC_SUPABASE_URL = orig;
    });

    it("parses PKCE code from trusted host", () => {
      const intent = parseTeammeetUrl(
        "https://www.myteamnetwork.com/auth/callback?code=pkce_xyz"
      );
      expect(intent).toEqual({ kind: "auth-pkce", code: "pkce_xyz" });
    });

    it("parses PKCE code from supabase host", () => {
      const intent = parseTeammeetUrl(
        "https://example.supabase.co/auth/v1/callback?code=pkce_abc"
      );
      expect(intent).toEqual({ kind: "auth-pkce", code: "pkce_abc" });
    });

    it("parses implicit-flow tokens from hash", () => {
      const intent = parseTeammeetUrl(
        "https://www.myteamnetwork.com/auth/callback#access_token=at1&refresh_token=rt1"
      );
      expect(intent).toEqual({
        kind: "auth-implicit",
        accessToken: "at1",
        refreshToken: "rt1",
      });
    });

    it("parses oauth errors", () => {
      const intent = parseTeammeetUrl(
        "https://www.myteamnetwork.com/auth/callback?error=server_error&error_description=Boom"
      );
      expect(intent).toEqual({ kind: "auth-oauth-error", message: "Boom" });
    });

    it("ignores untrusted hosts", () => {
      const intent = parseTeammeetUrl(
        "https://evil.example.com/auth/callback?code=xyz"
      );
      expect(intent.kind).toBe("unknown");
    });

    it("rejects http:// trusted-host auth payloads (MITM defense)", () => {
      const intent = parseTeammeetUrl(
        "http://www.myteamnetwork.com/auth/callback?code=mitm_code"
      );
      expect(intent.kind).toBe("unknown");
    });
  });

  describe("app routes (native scheme)", () => {
    it("parses join-org via path token", () => {
      const intent = parseTeammeetUrl("teammeet://join/abc-token-123");
      expect(intent).toEqual({ kind: "join-org", token: "abc-token-123" });
    });

    it("parses join-org via query token", () => {
      const intent = parseTeammeetUrl("teammeet://join?token=def-456");
      expect(intent).toEqual({ kind: "join-org", token: "def-456" });
    });

    it("parses event with org slug", () => {
      const intent = parseTeammeetUrl("teammeet://event/evt-1?org=acme-hs");
      expect(intent).toEqual({
        kind: "event",
        orgSlug: "acme-hs",
        eventId: "evt-1",
      });
    });

    it("returns unknown for event without org slug", () => {
      const intent = parseTeammeetUrl("teammeet://event/evt-1");
      expect(intent.kind).toBe("unknown");
    });

    it("parses event-checkin with all fields", () => {
      const intent = parseTeammeetUrl(
        "teammeet://event-checkin/evt-1?org=acme-hs&user=user-99&sig=hmac"
      );
      expect(intent).toEqual({
        kind: "event-checkin",
        orgSlug: "acme-hs",
        eventId: "evt-1",
        userId: "user-99",
        sig: "hmac",
      });
    });

    it("parses event-checkin QR without member userId (venue self check-in)", () => {
      const intent = parseTeammeetUrl("teammeet://event-checkin/evt-42?org=acme-hs");
      expect(intent).toEqual({
        kind: "event-checkin",
        orgSlug: "acme-hs",
        eventId: "evt-42",
        userId: undefined,
        sig: undefined,
      });
    });

    it("parses announcement", () => {
      const intent = parseTeammeetUrl(
        "teammeet://announcement/ann-1?org=acme-hs"
      );
      expect(intent).toEqual({
        kind: "announcement",
        orgSlug: "acme-hs",
        id: "ann-1",
      });
    });

    it("parses shortcut with valid action", () => {
      const intent = parseTeammeetUrl(
        "teammeet://shortcut?action=new-announcement&org=acme-hs"
      );
      expect(intent).toEqual({
        kind: "shortcut",
        action: "new-announcement",
        orgSlug: "acme-hs",
      });
    });

    it("rejects shortcut with unknown action", () => {
      const intent = parseTeammeetUrl(
        "teammeet://shortcut?action=do-something-evil"
      );
      expect(intent.kind).toBe("unknown");
    });

    it("parses wallet-add", () => {
      const intent = parseTeammeetUrl(
        "teammeet://wallet-add?url=https%3A%2F%2Fexample.com%2Fpass.pkpass"
      );
      expect(intent).toEqual({
        kind: "wallet-add",
        passUrl: "https://example.com/pass.pkpass",
      });
    });

    it("parses native claim intent with code", () => {
      const intent = parseTeammeetUrl("teammeet://claim?code=ABC123");
      expect(intent).toEqual({ kind: "claim", code: "ABC123", redirect: undefined });
    });

    it("parses native claim intent with sanitized relative redirect", () => {
      const intent = parseTeammeetUrl(
        "teammeet://claim?code=ABC&redirect=/acme-hs/events/evt-1",
      );
      expect(intent).toEqual({
        kind: "claim",
        code: "ABC",
        redirect: "/acme-hs/events/evt-1",
      });
    });

    it("drops protocol-relative redirect on native claim intent", () => {
      const intent = parseTeammeetUrl(
        "teammeet://claim?code=ABC&redirect=//evil.com",
      );
      expect(intent).toEqual({
        kind: "claim",
        code: "ABC",
        redirect: undefined,
      });
    });

    it("drops absolute-url redirect on native claim intent", () => {
      const intent = parseTeammeetUrl(
        "teammeet://claim?redirect=https://evil.com",
      );
      expect(intent).toEqual({
        kind: "claim",
        code: undefined,
        redirect: undefined,
      });
    });
  });

  describe("claim (trusted web host)", () => {
    it("parses /auth/claim with code + redirect", () => {
      const intent = parseTeammeetUrl(
        "https://www.myteamnetwork.com/auth/claim?code=ABC123&redirect=/acme-hs"
      );
      expect(intent).toEqual({
        kind: "claim",
        code: "ABC123",
        redirect: "/acme-hs",
      });
    });

    it("treats /auth/claim with code as claim, not as PKCE auth", () => {
      const intent = parseTeammeetUrl(
        "https://www.myteamnetwork.com/auth/claim?code=XYZ"
      );
      expect(intent.kind).toBe("claim");
    });

    it("drops protocol-relative redirect (open-redirect defense)", () => {
      const intent = parseTeammeetUrl(
        "https://www.myteamnetwork.com/auth/claim?code=A&redirect=//evil.com"
      );
      expect(intent).toEqual({ kind: "claim", code: "A", redirect: undefined });
    });

    it("drops absolute-url redirect (open-redirect defense)", () => {
      const intent = parseTeammeetUrl(
        "https://www.myteamnetwork.com/auth/claim?redirect=https://evil.com"
      );
      expect(intent).toEqual({
        kind: "claim",
        code: undefined,
        redirect: undefined,
      });
    });

    it("matches mixed-case /Auth/Claim path (email-scanner rewrite)", () => {
      const intent = parseTeammeetUrl(
        "https://www.myteamnetwork.com/Auth/Claim?code=ABC123",
      );
      expect(intent.kind).toBe("claim");
      expect((intent as { code?: string }).code).toBe("ABC123");
    });

    it("matches uppercase /AUTH/CLAIM/extra path", () => {
      const intent = parseTeammeetUrl(
        "https://www.myteamnetwork.com/AUTH/CLAIM/extra?code=Z",
      );
      expect(intent.kind).toBe("claim");
    });

    it("still routes /auth/callback as PKCE auth (regression guard)", () => {
      const intent = parseTeammeetUrl(
        "https://www.myteamnetwork.com/auth/callback?code=PKCE",
      );
      expect(intent).toEqual({ kind: "auth-pkce", code: "PKCE" });
    });
  });

  describe("unknown / unparseable", () => {
    it("returns unknown for garbage input", () => {
      const intent = parseTeammeetUrl("not-a-url");
      expect(intent.kind).toBe("unknown");
    });

    it("returns unknown for unrecognised native scheme route", () => {
      const intent = parseTeammeetUrl("teammeet://something-new");
      expect(intent.kind).toBe("unknown");
    });

    it("returns unknown for non-teammeet, non-trusted URLs", () => {
      const intent = parseTeammeetUrl("https://google.com");
      expect(intent.kind).toBe("unknown");
    });
  });
});

describe("routeIntent", () => {
  it("routes member-specific event check-in to the registered check-in screen", async () => {
    const router = { push: jest.fn(), replace: jest.fn() };

    await routeIntent(router, {
      kind: "event-checkin",
      orgSlug: "acme-hs",
      eventId: "evt-1",
      userId: "user-99",
    });

    expect(router.push).toHaveBeenCalledWith(
      "/(app)/acme-hs/events/check-in?eventId=evt-1&user=user-99"
    );
  });

  it("routes event self check-in QR links to scanner self mode", async () => {
    const router = { push: jest.fn(), replace: jest.fn() };

    await routeIntent(router, {
      kind: "event-checkin",
      orgSlug: "acme-hs",
      eventId: "evt-42",
    });

    expect(router.push).toHaveBeenCalledWith(
      "/(app)/acme-hs/events/evt-42/scan?mode=self"
    );
  });

  it("routes join-org intents to the native join screen with the token", async () => {
    const router = { push: jest.fn(), replace: jest.fn() };

    await routeIntent(router, { kind: "join-org", token: "ABCD1234" });

    expect(router.push).toHaveBeenCalledWith({
      pathname: "/(app)/(drawer)/join-organization",
      params: { token: "ABCD1234" },
    });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("routes claim intents to the (auth)/claim screen with params", async () => {
    const router = { push: jest.fn(), replace: jest.fn() };

    await routeIntent(router, {
      kind: "claim",
      code: "ABC123",
      redirect: "/acme-hs",
    });

    expect(router.push).toHaveBeenCalledWith({
      pathname: "/(auth)/claim",
      params: { code: "ABC123", redirect: "/acme-hs" },
    });
  });

  it("routes claim intents with no params", async () => {
    const router = { push: jest.fn(), replace: jest.fn() };

    await routeIntent(router, { kind: "claim" });

    expect(router.push).toHaveBeenCalledWith({
      pathname: "/(auth)/claim",
      params: {},
    });
  });
});

describe("routeIntent auth-handoff (OS-listener fallback)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("surfaces the error (toast + Sentry) when the consume fails", async () => {
    const router = { push: jest.fn(), replace: jest.fn() };
    const consumeError = new Error("consume boom");
    (consumeMobileAuthHandoff as jest.Mock).mockRejectedValue(consumeError);

    await routeIntent(
      router,
      { kind: "auth-handoff", code: "abc123" },
      "teammeet://callback?handoff_code=abc123"
    );

    // The previously-silent path now routes through the shared surfacing helper,
    // which captures to Sentry AND shows a toast.
    expect(surfaceMobileAuthError).toHaveBeenCalledTimes(1);
    const [errArg, contextArg, navigateArg] = (surfaceMobileAuthError as jest.Mock)
      .mock.calls[0];
    expect(errArg).toBe(consumeError);
    expect(contextArg).toMatchObject({ context: "routeIntent.auth-handoff" });
    expect(typeof navigateArg).toBe("function");

    // Retry action must navigate back to login (never re-POST the single-use code).
    navigateArg("/(auth)/login");
    expect(router.replace).toHaveBeenCalledWith("/(auth)/login");
  });

  it("does not surface an error when the consume succeeds", async () => {
    const router = { push: jest.fn(), replace: jest.fn() };
    (consumeMobileAuthHandoff as jest.Mock).mockResolvedValue(undefined);

    await routeIntent(router, { kind: "auth-handoff", code: "ok" });

    expect(surfaceMobileAuthError).not.toHaveBeenCalled();
  });
});

describe("routeIntent auth-error (native scheme: actionable, not silent, but NOT attacker-controlled text)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("surfaces app-owned copy — NOT the raw native-scheme message (phishing defense)", async () => {
    const router = { push: jest.fn(), replace: jest.fn() };
    // The native teammeet:// scheme is untrusted — any app can supply this text
    // as the error_description (which arrives here as rawMessage).
    const attackerControlled =
      "Session expired — reverify your card at evil.example.com";

    await routeIntent(router, {
      kind: "auth-error",
      errorCode: "access_denied",
      rawMessage: attackerControlled,
    });

    // Must NOT render the attacker/native-supplied string.
    expect(showToast).not.toHaveBeenCalledWith(attackerControlled, "error");
    // Must show fixed app-owned copy (from the CODE) instead; raw value → Sentry.
    expect(showToast).toHaveBeenCalledTimes(1);
    const [shownMessage, variant] = (showToast as jest.Mock).mock.calls[0];
    expect(variant).toBe("error");
    expect(shownMessage).not.toContain("evil.example.com");
    // access_denied → the shared getMobileAuthCallbackErrorMessage copy.
    expect(shownMessage).toMatch(/try again and allow access/i);
  });

  it("maps a known error code to its specific app-owned copy (shared mapping)", async () => {
    const router = { push: jest.fn(), replace: jest.fn() };
    await routeIntent(router, {
      kind: "auth-error",
      errorCode: "terms_acceptance_required",
      rawMessage: "anything",
    });
    const [shownMessage] = (showToast as jest.Mock).mock.calls[0];
    expect(shownMessage).toMatch(/finish creating your account on the web/i);
  });

  it("still captures the raw native-scheme error to Sentry for diagnostics", async () => {
    const router = { push: jest.fn(), replace: jest.fn() };
    await routeIntent(router, {
      kind: "auth-error",
      errorCode: "terms_acceptance_required",
      rawMessage: "raw server text",
    });
    // Not silent: it's captured even though the toast copy is generic.
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("surfaces auth-oauth-error messages verbatim (this path IS gated to HTTPS trusted hosts)", async () => {
    const router = { push: jest.fn(), replace: jest.fn() };

    await routeIntent(router, {
      kind: "auth-oauth-error",
      message: "Sign-in was declined.",
    });

    expect(showToast).toHaveBeenCalledWith("Sign-in was declined.", "error");
  });
});
