/**
 * useInvites Hook Helper Functions Tests
 * Tests invite validation helper functions (pure functions only)
 */

// Only test the pure helper functions, not the hook itself
// The hook requires React Native environment
describe("Invite Helper Functions", () => {
  // Import helpers after mocking
  let getInviteLink: typeof import("../../src/hooks/useInvites").getInviteLink;
  let isInviteExpired: typeof import("../../src/hooks/useInvites").isInviteExpired;
  let isInviteRevoked: typeof import("../../src/hooks/useInvites").isInviteRevoked;
  let isInviteExhausted: typeof import("../../src/hooks/useInvites").isInviteExhausted;
  let isInviteValid: typeof import("../../src/hooks/useInvites").isInviteValid;
  type Invite = import("../../src/hooks/useInvites").Invite;

  beforeAll(() => {
    // Mock the Supabase module so we can import the helpers
    jest.mock("@/lib/supabase", () => ({
      supabase: {
        from: jest.fn(),
        rpc: jest.fn(),
        auth: { getUser: jest.fn() },
        channel: jest.fn(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() })),
        removeChannel: jest.fn(),
      },
    }));

    // Mock React since we're only testing pure functions
    jest.mock("react", () => ({
      useEffect: jest.fn(),
      useState: jest.fn(),
      useRef: jest.fn(),
      useCallback: jest.fn(),
    }));

    // Now import the module
    const mod = require("../../src/hooks/useInvites");
    getInviteLink = mod.getInviteLink;
    isInviteExpired = mod.isInviteExpired;
    isInviteRevoked = mod.isInviteRevoked;
    isInviteExhausted = mod.isInviteExhausted;
    isInviteValid = mod.isInviteValid;
  });

  afterAll(() => {
    jest.unmock("@/lib/supabase");
    jest.unmock("react");
  });

  describe("getInviteLink", () => {
    it("should return token-based link when token exists", () => {
      const invite: Invite = {
        id: "inv-123",
        code: "ABC123",
        token: "secret-token-xyz",
        role: "active_member",
        uses_remaining: 10,
        expires_at: null,
        revoked_at: null,
        created_at: "2024-01-01T00:00:00Z",
      };
      const link = getInviteLink(invite, "https://example.com");
      expect(link).toBe("https://example.com/app/join?token=secret-token-xyz");
    });

    it("should return code-based link when no token", () => {
      const invite: Invite = {
        id: "inv-123",
        code: "ABC123",
        token: null,
        role: "active_member",
        uses_remaining: 10,
        expires_at: null,
        revoked_at: null,
        created_at: "2024-01-01T00:00:00Z",
      };
      const link = getInviteLink(invite, "https://example.com");
      expect(link).toBe("https://example.com/app/join?code=ABC123");
    });

    it("should work with different base URLs", () => {
      const invite: Invite = {
        id: "inv-123",
        code: "XYZ789",
        token: null,
        role: "admin",
        uses_remaining: null,
        expires_at: null,
        revoked_at: null,
        created_at: "2024-01-01T00:00:00Z",
      };
      const link = getInviteLink(invite, "https://myteamnetwork.com");
      expect(link).toBe("https://myteamnetwork.com/app/join?code=XYZ789");
    });
  });

  describe("isInviteExpired", () => {
    it("should return false when expires_at is null", () => {
      expect(isInviteExpired(null)).toBe(false);
    });

    it("should return true when expires_at is in the past", () => {
      const pastDate = "2020-01-01T00:00:00Z";
      expect(isInviteExpired(pastDate)).toBe(true);
    });

    it("should return false when expires_at is in the future", () => {
      const futureDate = "2099-01-01T00:00:00Z";
      expect(isInviteExpired(futureDate)).toBe(false);
    });

    it("should handle ISO date strings", () => {
      const pastDate = new Date(Date.now() - 1000).toISOString();
      expect(isInviteExpired(pastDate)).toBe(true);
    });
  });

  describe("isInviteRevoked", () => {
    it("should return false when revoked_at is null", () => {
      expect(isInviteRevoked(null)).toBe(false);
    });

    it("should return true when revoked_at has a value", () => {
      expect(isInviteRevoked("2024-01-01T00:00:00Z")).toBe(true);
    });

    it("should return true for any truthy revoked_at", () => {
      expect(isInviteRevoked("any-date")).toBe(true);
    });
  });

  describe("isInviteExhausted", () => {
    it("should return false when uses_remaining is null (unlimited)", () => {
      expect(isInviteExhausted(null)).toBe(false);
    });

    it("should return true when uses_remaining is 0", () => {
      expect(isInviteExhausted(0)).toBe(true);
    });

    it("should return true when uses_remaining is negative", () => {
      expect(isInviteExhausted(-1)).toBe(true);
    });

    it("should return false when uses_remaining is positive", () => {
      expect(isInviteExhausted(1)).toBe(false);
      expect(isInviteExhausted(10)).toBe(false);
      expect(isInviteExhausted(100)).toBe(false);
    });
  });

  describe("isInviteValid", () => {
    const createValidInvite = (): Invite => ({
      id: "inv-123",
      code: "ABC123",
      token: null,
      role: "active_member",
      uses_remaining: null,
      expires_at: null,
      revoked_at: null,
      created_at: "2024-01-01T00:00:00Z",
    });

    it("should return true for valid invite with unlimited uses", () => {
      const invite = createValidInvite();
      expect(isInviteValid(invite)).toBe(true);
    });

    it("should return true for valid invite with remaining uses", () => {
      const invite = { ...createValidInvite(), uses_remaining: 5 };
      expect(isInviteValid(invite)).toBe(true);
    });

    it("should return true for valid invite with future expiry", () => {
      const invite = {
        ...createValidInvite(),
        expires_at: "2099-12-31T23:59:59Z",
      };
      expect(isInviteValid(invite)).toBe(true);
    });

    it("should return false for expired invite", () => {
      const invite = {
        ...createValidInvite(),
        expires_at: "2020-01-01T00:00:00Z",
      };
      expect(isInviteValid(invite)).toBe(false);
    });

    it("should return false for revoked invite", () => {
      const invite = {
        ...createValidInvite(),
        revoked_at: "2024-06-01T00:00:00Z",
      };
      expect(isInviteValid(invite)).toBe(false);
    });

    it("should return false for exhausted invite", () => {
      const invite = { ...createValidInvite(), uses_remaining: 0 };
      expect(isInviteValid(invite)).toBe(false);
    });

    it("should return false when multiple conditions fail", () => {
      const invite = {
        ...createValidInvite(),
        expires_at: "2020-01-01T00:00:00Z",
        revoked_at: "2020-06-01T00:00:00Z",
        uses_remaining: 0,
      };
      expect(isInviteValid(invite)).toBe(false);
    });
  });
});
