import {
  assertEmailConfirmed,
  consumeClaimRate,
  __resetClaimRateForTests,
} from "@/lib/auth/claim-guards";

describe("consumeClaimRate", () => {
  beforeEach(() => {
    __resetClaimRateForTests();
  });

  it("allows the first 10 calls within the 60s window", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(consumeClaimRate("user-1", t0 + i * 100)).toBe(true);
    }
  });

  it("rejects the 11th call within the 60s window", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) {
      consumeClaimRate("user-1", t0 + i * 100);
    }
    expect(consumeClaimRate("user-1", t0 + 1500)).toBe(false);
  });

  it("slides the window: 11th call after 60s succeeds", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) {
      consumeClaimRate("user-1", t0 + i * 100);
    }
    expect(consumeClaimRate("user-1", t0 + 61_000)).toBe(true);
  });

  it("rate-limits per user id", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) {
      consumeClaimRate("user-1", t0 + i * 100);
    }
    expect(consumeClaimRate("user-2", t0 + 1500)).toBe(true);
  });
});

describe("assertEmailConfirmed", () => {
  it("throws when email_confirmed_at is null", () => {
    expect(() =>
      assertEmailConfirmed({ email_confirmed_at: null }),
    ).toThrow("Email not verified");
  });

  it("throws when email_confirmed_at is empty string", () => {
    expect(() => assertEmailConfirmed({ email_confirmed_at: "" })).toThrow(
      "Email not verified",
    );
  });

  it("throws when email_confirmed_at is undefined", () => {
    expect(() => assertEmailConfirmed({})).toThrow("Email not verified");
  });

  it("does not throw for an ISO timestamp", () => {
    expect(() =>
      assertEmailConfirmed({ email_confirmed_at: "2026-05-25T00:00:00Z" }),
    ).not.toThrow();
  });
});
