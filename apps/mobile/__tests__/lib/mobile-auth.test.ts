import { supabase } from "@/lib/supabase";
import {
  consumeMobileAuthHandoff,
  validateSignupAge,
  MobileAuthError,
} from "@/lib/mobile-auth";

function mockFetchResponse(opts: {
  ok: boolean;
  status: number;
  body?: unknown;
}) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: opts.ok,
    status: opts.status,
    json: jest.fn().mockResolvedValue(opts.body ?? {}),
  }) as jest.Mock;
}

describe("mobile auth API helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    (supabase.auth.setSession as jest.Mock).mockResolvedValue({
      data: { session: {} },
      error: null,
    });
  });

  describe("consumeMobileAuthHandoff", () => {
    it("consumes a handoff code and applies the Supabase session", async () => {
      mockFetchResponse({
        ok: true,
        status: 200,
        body: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
      });

      await consumeMobileAuthHandoff("handoff-code");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://www.myteamnetwork.com/api/auth/mobile-handoff/consume",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ code: "handoff-code" }),
        })
      );
      expect(supabase.auth.setSession).toHaveBeenCalledTimes(1);
      expect(supabase.auth.setSession).toHaveBeenCalledWith({
        access_token: "access-token",
        refresh_token: "refresh-token",
      });
    });

    it("classifies HTTP 400 as expired (single-use link)", async () => {
      mockFetchResponse({ ok: false, status: 400, body: { error: "gone" } });

      await expect(consumeMobileAuthHandoff("code")).rejects.toMatchObject({
        status: "expired",
        message: "This sign-in link has expired. Please try signing in again.",
      });
      expect(supabase.auth.setSession).not.toHaveBeenCalled();
    });

    it("classifies HTTP 401 as unauthorized (NOT expired)", async () => {
      mockFetchResponse({ ok: false, status: 401, body: {} });

      const err = await consumeMobileAuthHandoff("code").catch((e) => e);
      expect(err).toBeInstanceOf(MobileAuthError);
      expect(err.status).toBe("unauthorized");
      expect(err.message).not.toMatch(/expired/i);
      expect(supabase.auth.setSession).not.toHaveBeenCalled();
    });

    it("classifies HTTP 500 as server error", async () => {
      mockFetchResponse({ ok: false, status: 500, body: {} });

      await expect(consumeMobileAuthHandoff("code")).rejects.toMatchObject({
        status: "server",
      });
      expect(supabase.auth.setSession).not.toHaveBeenCalled();
    });

    it("classifies a 200 body missing tokens as malformed", async () => {
      mockFetchResponse({ ok: true, status: 200, body: { access_token: "only-one" } });

      await expect(consumeMobileAuthHandoff("code")).rejects.toMatchObject({
        status: "malformed",
      });
      expect(supabase.auth.setSession).not.toHaveBeenCalled();
    });

    it("classifies a setSession failure as session-error and does not swallow it", async () => {
      mockFetchResponse({
        ok: true,
        status: 200,
        body: { access_token: "a", refresh_token: "r" },
      });
      (supabase.auth.setSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: new Error("bad token"),
      });

      await expect(consumeMobileAuthHandoff("code")).rejects.toMatchObject({
        status: "session-error",
      });
      expect(supabase.auth.setSession).toHaveBeenCalledTimes(1);
    });

    it("classifies fetch failure after all retries as network", async () => {
      jest.useFakeTimers();
      global.fetch = jest.fn().mockRejectedValue(new TypeError("Network request failed"));

      const promise = consumeMobileAuthHandoff("code");
      const assertion = expect(promise).rejects.toMatchObject({ status: "network" });
      // Two retry delays (300ms, 800ms) then final failure.
      await jest.advanceTimersByTimeAsync(300);
      await jest.advanceTimersByTimeAsync(800);
      await assertion;

      // Initial attempt + 2 retries = 3 fetch calls.
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(supabase.auth.setSession).not.toHaveBeenCalled();
    });

    it("retries a transient network error then succeeds", async () => {
      jest.useFakeTimers();
      global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new TypeError("Network request failed"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest
            .fn()
            .mockResolvedValue({ access_token: "a", refresh_token: "r" }),
        });

      const promise = consumeMobileAuthHandoff("code");
      await jest.advanceTimersByTimeAsync(300);
      await promise;

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(supabase.auth.setSession).toHaveBeenCalledTimes(1);
    });
  });

  it("validates signup age through the web API", async () => {
    mockFetchResponse({
      ok: true,
      status: 200,
      body: {
        token: "age-token",
        ageBracket: "18_plus",
        isMinor: false,
      },
    });

    await expect(validateSignupAge("18_plus")).resolves.toEqual({
      token: "age-token",
      ageBracket: "18_plus",
      isMinor: false,
    });
  });
});
