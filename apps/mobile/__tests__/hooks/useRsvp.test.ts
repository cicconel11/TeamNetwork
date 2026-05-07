/**
 * useRsvp Helpers Tests
 *
 * Covers the pure async helpers that back the React hook:
 *   - setEventRsvp: upsert against event_rsvps with Sentry on error.
 *   - promptAndSetRsvp: open Alert picker, dispatch on selection.
 *
 * The hook itself (useRsvp) requires a React Native renderer + AuthContext
 * which is out of scope for this jest harness; we already cover the network
 * layer here and the UI binding is exercised by the route-screen e2e flow.
 */

import { supabase } from "@/lib/supabase";

const mockUpsert = jest.fn();
const mockSentry = jest.fn();
const mockTrack = jest.fn();
const mockAlert = jest.fn();

jest.mock("react-native", () => ({
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
  Platform: { OS: "ios" },
  StyleSheet: { create: (s: unknown) => s },
  NativeModules: {},
  NativeEventEmitter: jest.fn(() => ({
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  })),
}));

jest.mock("@/lib/analytics/sentry", () => ({
  captureException: (...args: unknown[]) => mockSentry(...args),
}));

jest.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

jest.mock("@/components/ui/Toast", () => ({
  showToast: jest.fn(),
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u-1" } }),
}));

beforeEach(() => {
  // Override the global supabase mock from jest.setup.js so `from(...).upsert(...)`
  // routes to our local jest.fn(). The global mock chains `.upsert` via
  // `mockReturnThis()`, which doesn't let us assert call args or resolve a
  // value.
  (supabase.from as jest.Mock).mockImplementation(() => ({
    upsert: mockUpsert,
  }));
  mockUpsert.mockReset();
  mockSentry.mockReset();
  mockTrack.mockReset();
});

describe("setEventRsvp", () => {
  let setEventRsvp: typeof import("../../src/hooks/useRsvp").setEventRsvp;

  beforeAll(() => {
    setEventRsvp = require("../../src/hooks/useRsvp").setEventRsvp;
  });

  it("persists the RSVP and emits an analytics event on success", async () => {
    mockUpsert.mockResolvedValueOnce({ error: null });

    const result = await setEventRsvp({
      eventId: "evt-1",
      organizationId: "org-1",
      userId: "u-1",
      status: "attending",
    });

    expect(result).toEqual({ ok: true });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: "evt-1",
        user_id: "u-1",
        organization_id: "org-1",
        status: "attending",
      }),
      { onConflict: "event_id,user_id" },
    );
    expect(mockTrack).toHaveBeenCalledWith(
      "event_rsvp_set",
      expect.objectContaining({
        event_id: "evt-1",
        org_id: "org-1",
        status: "attending",
      }),
    );
  });

  it("returns { ok: false } and reports to Sentry on supabase error", async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: "rls denied" } });

    const result = await setEventRsvp({
      eventId: "evt-2",
      organizationId: "org-2",
      userId: "u-1",
      status: "not_attending",
    });

    expect(result).toEqual({ ok: false, error: "rls denied" });
    expect(mockSentry).toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("catches thrown errors and surfaces them as { ok: false }", async () => {
    mockUpsert.mockRejectedValueOnce(new Error("network down"));

    const result = await setEventRsvp({
      eventId: "evt-3",
      organizationId: "org-3",
      userId: "u-1",
      status: "maybe",
    });

    expect(result).toEqual({ ok: false, error: "network down" });
    expect(mockSentry).toHaveBeenCalled();
  });
});

describe("promptAndSetRsvp", () => {
  let promptAndSetRsvp: typeof import("../../src/hooks/useRsvp").promptAndSetRsvp;

  beforeAll(() => {
    promptAndSetRsvp = require("../../src/hooks/useRsvp").promptAndSetRsvp;
  });

  beforeEach(() => {
    mockAlert.mockReset();
  });

  it("opens an Alert with Going / Maybe / Can't Go / Cancel buttons", () => {
    promptAndSetRsvp({
      eventId: "evt-1",
      organizationId: "org-1",
      userId: "u-1",
    });

    expect(mockAlert).toHaveBeenCalledTimes(1);
    const buttons = (
      mockAlert.mock.calls[0][2] as Array<{ text: string }>
    ).map((b) => b.text);
    expect(buttons).toEqual(["Going", "Maybe", "Can't Go", "Cancel"]);
  });

  it("dispatches setEventRsvp('attending') when 'Going' is tapped", async () => {
    mockUpsert.mockResolvedValueOnce({ error: null });

    const onComplete = jest.fn();
    promptAndSetRsvp({
      eventId: "evt-1",
      organizationId: "org-1",
      userId: "u-1",
      onComplete,
    });

    const buttons = mockAlert.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const goingButton = buttons.find((b) => b.text === "Going");
    goingButton?.onPress?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "attending" }),
      expect.anything(),
    );
    expect(onComplete).toHaveBeenCalledWith({ ok: true, status: "attending" });
  });
});
