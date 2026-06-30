import {
  getConnectionSuggestions,
  startConnectionChat,
} from "@/lib/connections-api";
import { fetchWithAuth } from "@/lib/web-api";

jest.mock("@/lib/web-api", () => ({
  fetchWithAuth: jest.fn(),
}));

const mockFetchWithAuth = fetchWithAuth as jest.Mock;

describe("connections api", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads viewer-scoped connection suggestions", async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        state: "ok",
        suggestions: [
          {
            person_type: "alumni",
            person_id: "person-1",
            name: "Alex Alum",
            subtitle: "Finance",
            messageable: true,
            score: 32,
            strength: "strong",
            preview: { industry: "Finance" },
            reasons: [],
          },
        ],
      }),
    });

    await expect(getConnectionSuggestions("org-1")).resolves.toEqual({
      state: "ok",
      suggestions: [
        expect.objectContaining({
          person_type: "alumni",
          person_id: "person-1",
          name: "Alex Alum",
        }),
      ],
    });

    expect(mockFetchWithAuth).toHaveBeenCalledWith(
      "/api/organizations/org-1/connections/suggestions",
      { method: "GET" }
    );
  });

  it("starts a profile direct chat for a suggestion", async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ chatGroupId: "chat-1", reused: false }),
    });

    await expect(
      startConnectionChat({
        orgId: "org-1",
        profileType: "parent",
        profileId: "parent-1",
      })
    ).resolves.toEqual({ chatGroupId: "chat-1", reused: false });

    expect(mockFetchWithAuth).toHaveBeenCalledWith(
      "/api/organizations/org-1/direct-chat/profile",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileType: "parent",
          profileId: "parent-1",
        }),
      }
    );
  });

  it("surfaces API errors with response status and code", async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: false,
      status: 403,
      json: jest.fn().mockResolvedValue({
        error: "Forbidden",
        code: "not_allowed",
      }),
    });

    await expect(getConnectionSuggestions("org-1")).rejects.toMatchObject({
      message: "Forbidden",
      status: 403,
      code: "not_allowed",
    });
  });
});
