jest.unmock("@/lib/analytics/sentry");

import { normalizeUnknownToError } from "@/lib/analytics/sentry";

describe("normalizeUnknownToError", () => {
  it("returns the same Error instance", () => {
    const err = new Error("boom");
    expect(normalizeUnknownToError(err)).toBe(err);
  });

  it("wraps Supabase-style plain objects with message and code", () => {
    const supabaseLike = {
      code: "refresh_token_not_found",
      message: "Invalid Refresh Token: Refresh Token Not Found",
      details: "some details",
      hint: "some hint",
    };
    const out = normalizeUnknownToError(supabaseLike);
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toBe("Invalid Refresh Token: Refresh Token Not Found");
    expect(out.name).toBe("Error(refresh_token_not_found)");
  });

  it("uses JSON when message is missing", () => {
    const out = normalizeUnknownToError({ code: "x", foo: 1 });
    expect(out.message).toBe('{"code":"x","foo":1}');
    expect(out.name).toBe("Error(x)");
  });

  it("handles null and string", () => {
    expect(normalizeUnknownToError(null).message).toBe("Unknown error");
    expect(normalizeUnknownToError("oops").message).toBe("oops");
  });
});
