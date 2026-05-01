describe("createPostgresChangesChannel", () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalKey;
    jest.dontMock("@/lib/auth-storage");
    jest.dontMock("@/lib/analytics");
    jest.dontMock("@supabase/supabase-js");
  });

  it("uses a unique channel topic on each call so listeners are not added after subscribe on a reused channel", () => {
    const channel = jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn(),
    }));
    const createClient = jest.fn(() => ({ channel }));

    jest.doMock("@/lib/auth-storage", () => ({
      getSupabaseStorage: () => ({}),
    }));
    jest.doMock("@/lib/analytics", () => ({
      captureException: jest.fn(),
      reset: jest.fn(),
    }));
    jest.doMock("@supabase/supabase-js", () => ({
      createClient,
    }));

    const { createPostgresChangesChannel } = require("../../src/lib/supabase");

    createPostgresChangesChannel("events:org-1");
    createPostgresChangesChannel("events:org-1");

    expect(channel).toHaveBeenCalledTimes(2);
    expect(channel.mock.calls[0][0]).toMatch(/^events:org-1:/);
    expect(channel.mock.calls[1][0]).toMatch(/^events:org-1:/);
    expect(channel.mock.calls[0][0]).not.toEqual(channel.mock.calls[1][0]);
  });
});
