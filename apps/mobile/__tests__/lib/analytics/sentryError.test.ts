import {
  buildCaptureExtra,
  isPostgrestStyleError,
  normalizeCaptureError,
} from "../../../src/lib/analytics/sentryError";

describe("sentryError", () => {
  describe("isPostgrestStyleError", () => {
    it("returns true for PostgREST-shaped objects", () => {
      expect(
        isPostgrestStyleError({
          code: "PGRST116",
          message: "not found",
          details: "x",
          hint: null,
        })
      ).toBe(true);
    });

    it("returns false when a key is missing", () => {
      expect(
        isPostgrestStyleError({
          code: "PGRST116",
          message: "not found",
          details: "x",
        })
      ).toBe(false);
    });
  });

  describe("normalizeCaptureError", () => {
    it("returns the same Error instance", () => {
      const err = new Error("boom");
      expect(normalizeCaptureError(err)).toBe(err);
    });

    it("wraps PostgREST-style objects with a readable message", () => {
      const err = normalizeCaptureError({
        code: "42501",
        message: "permission denied",
        details: null,
        hint: null,
      });
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("permission denied");
      expect(err.name).toBe("PostgrestError");
    });

    it("uses code when message is empty", () => {
      const err = normalizeCaptureError({
        code: "XX000",
        message: "",
        details: null,
        hint: null,
      });
      expect(err.message).toBe("PostgREST error: XX000");
    });

    it("stringifies unknown objects", () => {
      const err = normalizeCaptureError({ foo: 1 });
      expect(err.message).toBe('{"foo":1}');
    });
  });

  describe("buildCaptureExtra", () => {
    it("merges context and supabaseError for PostgREST shapes", () => {
      const pg = {
        code: "c",
        message: "m",
        details: "d",
        hint: "h",
      };
      const extra = buildCaptureExtra(pg, { context: "AuthContext.getSession" });
      expect(extra).toEqual({
        context: "AuthContext.getSession",
        supabaseError: { code: "c", message: "m", details: "d", hint: "h" },
      });
    });

    it("returns only context for normal errors", () => {
      const extra = buildCaptureExtra(new Error("x"), { screen: "Login" });
      expect(extra).toEqual({ screen: "Login" });
    });
  });
});
