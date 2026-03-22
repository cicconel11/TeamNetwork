import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseAIChatFailure } from "../src/hooks/useAIStream.ts";

describe("parseAIChatFailure", () => {
  it("treats 409 responses with a threadId as recoverable in-flight retries", () => {
    const failure = parseAIChatFailure(409, {
      error: "Request already in progress",
      threadId: "thread-123",
    });

    assert.deepEqual(failure, {
      result: {
        threadId: "thread-123",
        inFlight: true,
      },
      error: null,
    });
  });

  it("keeps non-recoverable failures as errors", () => {
    const failure = parseAIChatFailure(500, {
      error: "Request failed",
      threadId: "thread-123",
    });

    assert.deepEqual(failure, {
      result: null,
      error: "Request failed",
    });
  });
});
