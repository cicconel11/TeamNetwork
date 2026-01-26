/**
 * Supabase JS Mock
 * Provides a comprehensive mock for @supabase/supabase-js
 */

export const createClient = jest.fn(() => ({
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    like: jest.fn().mockReturnThis(),
    ilike: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    contains: jest.fn().mockReturnThis(),
    containedBy: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    textSearch: jest.fn().mockReturnThis(),
    filter: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    match: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: [], error: null }),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
  })),
  rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  auth: {
    getUser: jest.fn().mockResolvedValue({
      data: { user: { id: "test-user-id", email: "test@example.com" } },
      error: null,
    }),
    getSession: jest.fn().mockResolvedValue({
      data: {
        session: {
          access_token: "mock-access-token",
          refresh_token: "mock-refresh-token",
          user: { id: "test-user-id", email: "test@example.com" },
        },
      },
      error: null,
    }),
    signInWithPassword: jest.fn().mockResolvedValue({
      data: { user: { id: "test-user-id" }, session: {} },
      error: null,
    }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
    onAuthStateChange: jest.fn().mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    }),
    signUp: jest.fn().mockResolvedValue({
      data: { user: { id: "new-user-id" }, session: {} },
      error: null,
    }),
    signInWithOAuth: jest.fn().mockResolvedValue({
      data: { provider: "google", url: "https://mock-oauth-url" },
      error: null,
    }),
  },
  channel: jest.fn(() => ({
    on: jest.fn().mockReturnThis(),
    subscribe: jest.fn().mockReturnValue({
      unsubscribe: jest.fn(),
    }),
  })),
  removeChannel: jest.fn(),
  storage: {
    from: jest.fn(() => ({
      upload: jest.fn().mockResolvedValue({
        data: { path: "mock-upload-path" },
        error: null,
      }),
      download: jest.fn().mockResolvedValue({
        data: new Blob(),
        error: null,
      }),
      remove: jest.fn().mockResolvedValue({
        data: { path: "mock-removed-path" },
        error: null,
      }),
      createSignedUrl: jest.fn().mockResolvedValue({
        data: { signedUrl: "https://mock-signed-url.com/file" },
        error: null,
      }),
      getPublicUrl: jest.fn().mockReturnValue({
        data: { publicUrl: "https://mock-public-url.com/file" },
      }),
      list: jest.fn().mockResolvedValue({
        data: [],
        error: null,
      }),
    })),
  },
}));

export default { createClient };
