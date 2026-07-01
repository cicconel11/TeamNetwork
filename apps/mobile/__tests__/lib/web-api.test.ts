import { buildAuthorizedHeaders, fetchWithAuth } from "@/lib/web-api";
import { supabase } from "@/lib/supabase";

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockRefreshSession = jest.fn();

describe("web api helpers", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;

    // Assign refreshSession mock onto the mocked supabase
    (supabase.auth as Record<string, unknown>).refreshSession = mockRefreshSession;

    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: "initial-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    });
    mockRefreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: "refreshed-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    });
    mockFetch.mockResolvedValue({ ok: true });
  });

  it("builds authorized headers from plain objects", () => {
    const headers = buildAuthorizedHeaders({ "Content-Type": "application/json" }, "token-123");

    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer token-123");
  });

  it("preserves existing Headers instances", () => {
    const headers = buildAuthorizedHeaders(
      new Headers({ Accept: "application/json" }),
      "token-123"
    );

    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer token-123");
  });

  it("adds the auth token to outgoing requests", async () => {
    await fetchWithAuth("/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });

    expect(mockFetch).toHaveBeenCalledWith("https://www.myteamnetwork.com/api/test", {
      method: "POST",
      headers: expect.any(Headers),
      body: JSON.stringify({ ok: true }),
    });

    const headers = mockFetch.mock.calls[0][1].headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer initial-token");
  });

  it("refreshes the session when the token is about to expire", async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: "stale-token",
          expires_at: Math.floor(Date.now() / 1000) + 10,
        },
      },
    });

    await fetchWithAuth("/api/test");

    expect(mockRefreshSession).toHaveBeenCalled();
    const headers = mockFetch.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer refreshed-token");
  });

  it("throws when the user is not authenticated", async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: null,
      },
    });

    await expect(fetchWithAuth("/api/test")).rejects.toThrow("Not authenticated");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
