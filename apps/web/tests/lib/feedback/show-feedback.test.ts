import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { toast } from "sonner";

const calls: Array<{ method: string; msg: string; options?: { duration?: number } }> = [];
const originalSuccess = toast.success;
const originalError = toast.error;
const originalWarning = toast.warning;

const { showFeedback } = await import("@/lib/feedback/show-feedback");

describe("showFeedback routing logic", () => {
  beforeEach(() => {
    calls.length = 0;
    toast.success = ((msg: string, options?: { duration?: number }) => {
      calls.push({ method: "success", msg, options });
    }) as typeof toast.success;
    toast.error = ((msg: string, options?: { duration?: number }) => {
      calls.push({ method: "error", msg, options });
    }) as typeof toast.error;
    toast.warning = ((msg: string, options?: { duration?: number }) => {
      calls.push({ method: "warning", msg, options });
    }) as typeof toast.warning;
  });

  afterEach(() => {
    toast.success = originalSuccess;
    toast.error = originalError;
    toast.warning = originalWarning;
  });

  it("routes success variant to toast.success", () => {
    showFeedback("Saved", "success");
    assert.deepStrictEqual(calls, [{ method: "success", msg: "Saved", options: undefined }]);
  });

  it("routes error variant to toast.error", () => {
    showFeedback("Failed", "error");
    assert.deepStrictEqual(calls, [{ method: "error", msg: "Failed", options: undefined }]);
  });

  it("routes warning variant to toast.warning", () => {
    showFeedback("Careful", "warning");
    assert.deepStrictEqual(calls, [{ method: "warning", msg: "Careful", options: undefined }]);
  });

  it("supports the default info path without throwing", () => {
    showFeedback("Note");
    assert.deepStrictEqual(calls, []);
  });

  it("passes options through to the underlying toast call", () => {
    showFeedback("Longer message", "success", { duration: 8000 });
    assert.deepStrictEqual(calls, [{
      method: "success",
      msg: "Longer message",
      options: { duration: 8000 },
    }]);
  });
});
