import test from "node:test";
import assert from "node:assert/strict";
import {
  INTERRUPTED_ASSISTANT_MESSAGE,
  FAILED_ASSISTANT_MESSAGE,
  finalizeAssistantMessage,
  normalizeAssistantMessageForDisplay,
} from "../src/lib/ai/assistant-message-display.ts";

test("finalizeAssistantMessage stores a friendly interrupted message for aborted turns", () => {
  assert.deepEqual(
    finalizeAssistantMessage({
      fullContent: "",
      streamCompletedSuccessfully: false,
      requestAborted: true,
    }),
    {
      status: "error",
      content: INTERRUPTED_ASSISTANT_MESSAGE,
    }
  );
});

test("finalizeAssistantMessage stores a friendly failure message for non-abort errors", () => {
  assert.deepEqual(
    finalizeAssistantMessage({
      fullContent: "",
      streamCompletedSuccessfully: false,
      requestAborted: false,
    }),
    {
      status: "error",
      content: FAILED_ASSISTANT_MESSAGE,
    }
  );
});

test("normalizeAssistantMessageForDisplay rewrites legacy abandoned sentinel rows", () => {
  assert.deepEqual(
    normalizeAssistantMessageForDisplay({
      id: "assistant-1",
      role: "assistant",
      content: "[abandoned]",
      status: "error",
      created_at: "2026-03-25T00:00:00Z",
    }),
    {
      id: "assistant-1",
      role: "assistant",
      content: INTERRUPTED_ASSISTANT_MESSAGE,
      status: "interrupted",
      created_at: "2026-03-25T00:00:00Z",
    }
  );
});

test("normalizeAssistantMessageForDisplay rewrites friendly interrupted error rows", () => {
  assert.deepEqual(
    normalizeAssistantMessageForDisplay({
      id: "assistant-2",
      role: "assistant",
      content: INTERRUPTED_ASSISTANT_MESSAGE,
      status: "error",
      created_at: "2026-03-25T00:00:00Z",
    }),
    {
      id: "assistant-2",
      role: "assistant",
      content: INTERRUPTED_ASSISTANT_MESSAGE,
      status: "interrupted",
      created_at: "2026-03-25T00:00:00Z",
    }
  );
});

test("normalizeAssistantMessageForDisplay makes partial streaming assistant rows safe after reload", () => {
  assert.deepEqual(
    normalizeAssistantMessageForDisplay({
      id: "assistant-3",
      role: "assistant",
      content: "Partial streamed answer",
      status: "streaming",
      created_at: "2026-03-25T00:00:00Z",
    }),
    {
      id: "assistant-3",
      role: "assistant",
      content: INTERRUPTED_ASSISTANT_MESSAGE,
      status: "interrupted",
      created_at: "2026-03-25T00:00:00Z",
    }
  );
});
