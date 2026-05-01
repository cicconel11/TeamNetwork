jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
    channel: jest.fn(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() })),
    removeChannel: jest.fn(),
  },
}));

jest.mock("@/lib/web-api", () => ({
  fetchWithAuth: jest.fn(),
}));

jest.mock("@/lib/analytics/sentry", () => ({
  captureException: jest.fn(),
}));

import { orgSettingsRealtimeChannelName } from "../../src/hooks/useOrgSettings";

describe("orgSettingsRealtimeChannelName", () => {
  it("builds a unique channel topic per org and hook instance", () => {
    expect(orgSettingsRealtimeChannelName("org-uuid", "inst-a")).toBe(
      "org-settings:org-uuid:inst-a"
    );
    expect(orgSettingsRealtimeChannelName("org-uuid", "inst-b")).toBe(
      "org-settings:org-uuid:inst-b"
    );
  });
});
