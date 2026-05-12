/**
 * waitForAuthUser — guards against the cold-launch race where AsyncStorage
 * hasn't rehydrated the Supabase session before OrgContext queries it.
 */

const mockGetUser = jest.fn();
const mockUnsubscribe = jest.fn();
let mockAuthChangeCb: ((event: string, session: { user: { id: string } } | null) => void) | null = null;

jest.mock("../../src/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
      onAuthStateChange: (cb: typeof mockAuthChangeCb) => {
        mockAuthChangeCb = cb;
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
      },
    },
  },
}));

jest.mock("expo-router", () => ({ useGlobalSearchParams: jest.fn(() => ({})) }));
jest.mock("../../src/lib/analytics", () => ({
  setUserProperties: jest.fn(),
  captureException: jest.fn(),
}));
jest.mock("@teammeet/core", () => ({ normalizeRole: (r: string) => r }));

import { waitForAuthUser } from "../../src/contexts/OrgContext";

describe("waitForAuthUser", () => {
  beforeEach(() => {
    mockAuthChangeCb = null;
    mockUnsubscribe.mockClear();
    mockGetUser.mockReset();
  });

  it("resolves with the user when onAuthStateChange fires before timeout", async () => {
    const promise = waitForAuthUser(500);
    setTimeout(() => mockAuthChangeCb?.("INITIAL_SESSION", { user: { id: "u1" } }), 10);
    await expect(promise).resolves.toEqual({ id: "u1" });
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it("falls back to getUser() on timeout and resolves with the recovered user", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "late" } } });
    const user = await waitForAuthUser(20);
    expect(user).toEqual({ id: "late" });
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it("resolves null when both onAuthStateChange and getUser yield nothing", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const user = await waitForAuthUser(20);
    expect(user).toBeNull();
  });

  it("does not resolve twice if onAuthStateChange fires after the timeout fallback", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "first" } } });
    const user = await waitForAuthUser(10);
    expect(user).toEqual({ id: "first" });
    mockAuthChangeCb?.("SIGNED_IN", { user: { id: "second" } });
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("ignores null-session events while still waiting", async () => {
    const promise = waitForAuthUser(50);
    mockAuthChangeCb?.("SIGNED_OUT", null);
    setTimeout(() => mockAuthChangeCb?.("SIGNED_IN", { user: { id: "u2" } }), 10);
    await expect(promise).resolves.toEqual({ id: "u2" });
  });
});
