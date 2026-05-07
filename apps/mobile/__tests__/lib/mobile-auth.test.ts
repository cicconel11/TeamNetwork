import { supabase } from "@/lib/supabase";
import { consumeMobileAuthHandoff, validateSignupAge } from "@/lib/mobile-auth";

describe("mobile auth API helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.auth.setSession as jest.Mock).mockResolvedValue({
      data: { session: {} },
      error: null,
    });
  });

  it("consumes a handoff code and applies the Supabase session", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        access_token: "access-token",
        refresh_token: "refresh-token",
      }),
    }) as jest.Mock;

    await consumeMobileAuthHandoff("handoff-code");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.myteamnetwork.com/api/auth/mobile-handoff/consume",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: "handoff-code" }),
      })
    );
    expect(supabase.auth.setSession).toHaveBeenCalledWith({
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
  });

  it("validates signup age through the web API", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        token: "age-token",
        ageBracket: "18_plus",
        isMinor: false,
      }),
    }) as jest.Mock;

    await expect(validateSignupAge("18_plus")).resolves.toEqual({
      token: "age-token",
      ageBracket: "18_plus",
      isMinor: false,
    });
  });
});
