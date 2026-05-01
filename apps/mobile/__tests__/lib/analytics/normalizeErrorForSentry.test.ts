import {
  normalizeErrorForSentry,
} from "../../../src/lib/analytics/normalizeErrorForSentry";

describe("normalizeErrorForSentry", () => {
  it("passes through Error instances", () => {
    const err = new Error("boom");
    const { error, extra } = normalizeErrorForSentry(err, { context: "test" });
    expect(error).toBe(err);
    expect(extra).toEqual({ context: "test" });
  });

  it("wraps Supabase-style error objects with code and message", () => {
    const thrown = {
      code: "PGRST116",
      message: "The result contains 0 rows",
      details: "The query returned no rows",
      hint: null,
    };
    const { error, extra } = normalizeErrorForSentry(thrown, {
      context: "AuthContext.getSession",
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("PGRST116");
    expect(error.message).toContain("The result contains 0 rows");
    expect(error.message).toContain("The query returned no rows");
    expect(extra.context).toBe("AuthContext.getSession");
    expect(extra.originalThrown).toEqual(thrown);
  });

  it("handles string throws", () => {
    const { error } = normalizeErrorForSentry("network failed");
    expect(error.message).toBe("network failed");
  });

  it("handles null/undefined", () => {
    const { error: n } = normalizeErrorForSentry(null);
    expect(n.message).toMatch(/null or undefined/);
    const { error: u } = normalizeErrorForSentry(undefined);
    expect(u.message).toMatch(/null or undefined/);
  });

  it("wraps arbitrary plain objects without supabase shape", () => {
    const { error, extra } = normalizeErrorForSentry({ foo: 1 });
    expect(error.message).toBe("Non-Error thrown (plain object)");
    expect(extra.originalThrown).toEqual({ foo: 1 });
  });
});
