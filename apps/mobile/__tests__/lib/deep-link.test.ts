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

jest.mock("@teammeet/validation", () => ({
  baseSchemas: {
    email: { safeParse: () => ({ success: true }) },
  },
}));

import { parseTeammeetUrl, routeIntent } from "@/lib/deep-link";

describe("parseTeammeetUrl", () => {
  describe("auth (native scheme)", () => {
    it("parses handoff codes", () => {
      const intent = parseTeammeetUrl("teammeet://callback?handoff_code=abc123");
      expect(intent).toEqual({ kind: "auth-handoff", code: "abc123" });
    });

    it("parses error callbacks with description", () => {
      const intent = parseTeammeetUrl(
        "teammeet://callback?error=access_denied&error_description=User%20cancelled"
      );
      expect(intent).toEqual({ kind: "auth-error", message: "User cancelled" });
    });

    it("parses error callbacks without description", () => {
      const intent = parseTeammeetUrl("teammeet://callback?error=access_denied");
      expect(intent).toEqual({ kind: "auth-error", message: "access_denied" });
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
});
