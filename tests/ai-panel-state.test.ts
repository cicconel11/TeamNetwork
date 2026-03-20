import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyThreadDeletion,
  createOptimisticUserMessage,
  removePanelMessage,
} from "../src/components/ai-assistant/panel-state.ts";

describe("AI panel state helpers", () => {
  it("creates an optimistic user message with stable defaults", () => {
    const message = createOptimisticUserMessage(
      "Hello world",
      "2026-03-20T12:00:00.000Z",
      "optimistic-1"
    );

    assert.deepEqual(message, {
      id: "optimistic-1",
      role: "user",
      content: "Hello world",
      status: "complete",
      created_at: "2026-03-20T12:00:00.000Z",
      optimistic: true,
    });
  });

  it("removes a single message without touching the rest of the transcript", () => {
    const messages = [
      createOptimisticUserMessage("Keep", "2026-03-20T12:00:00.000Z", "keep"),
      createOptimisticUserMessage("Remove", "2026-03-20T12:01:00.000Z", "remove"),
    ];

    assert.deepEqual(removePanelMessage(messages, "remove"), [messages[0]]);
  });

  it("clears the active thread and transcript when that thread is deleted", () => {
    const nextState = applyThreadDeletion(
      [
        { id: "thread-1", title: "Thread 1", surface: "general", updated_at: "2026-03-20T12:00:00.000Z" },
        { id: "thread-2", title: "Thread 2", surface: "general", updated_at: "2026-03-20T12:01:00.000Z" },
      ],
      "thread-1",
      [createOptimisticUserMessage("Hello", "2026-03-20T12:00:00.000Z", "optimistic-1")],
      "thread-1"
    );

    assert.equal(nextState.activeThreadId, null);
    assert.deepEqual(nextState.messages, []);
    assert.deepEqual(nextState.threads, [
      { id: "thread-2", title: "Thread 2", surface: "general", updated_at: "2026-03-20T12:01:00.000Z" },
    ]);
  });
});
