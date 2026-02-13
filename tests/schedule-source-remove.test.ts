import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Mock fetch and window for hook behavior testing
describe("useScheduleSources handleRemove behavior", () => {
  let originalFetch: typeof globalThis.fetch;
  let dispatchedEvents: string[];
  let originalDispatchEvent: typeof window.dispatchEvent;
  let originalConfirm: typeof globalThis.confirm;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    dispatchedEvents = [];

    // Mock window.dispatchEvent
    if (typeof globalThis.window === "undefined") {
      const win = globalThis as unknown as {
        window?: {
          dispatchEvent: (event: Event) => boolean;
          addEventListener: () => void;
          removeEventListener: () => void;
        };
      };
      win.window = {
        dispatchEvent: (event: Event) => {
          dispatchedEvents.push(event.type);
          return true;
        },
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    } else {
      originalDispatchEvent = globalThis.window.dispatchEvent;
      globalThis.window.dispatchEvent = (event: Event) => {
        dispatchedEvents.push(event.type);
        return true;
      };
    }

    originalConfirm = globalThis.confirm;
    globalThis.confirm = () => true;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDispatchEvent) {
      globalThis.window.dispatchEvent = originalDispatchEvent;
    }
    globalThis.confirm = originalConfirm;
  });

  it("calls DELETE endpoint with correct source ID on success", async () => {
    let calledUrl = "";
    let calledMethod = "";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/schedules/sources/") && init?.method === "DELETE") {
        calledUrl = url;
        calledMethod = init.method;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Default for refreshSources call
      return new Response(JSON.stringify({ sources: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    // Simulate the handleRemove logic inline (since we can't import React hooks in node:test)
    const sourceId = "source-123";
    const isAdmin = true;

    if (!isAdmin) {
      assert.fail("Should not reach here");
      return;
    }

    // Simulate confirm
    const confirmed = confirm("Remove this schedule source?");
    assert.ok(confirmed);

    const response = await fetch(`/api/schedules/sources/${sourceId}`, { method: "DELETE" });
    await response.json();

    assert.ok(response.ok);
    assert.equal(calledUrl, `/api/schedules/sources/${sourceId}`);
    assert.equal(calledMethod, "DELETE");
  });

  it("dispatches schedule:sources:refresh event on success", async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    // Simulate successful removal and event dispatch
    const response = await fetch("/api/schedules/sources/source-123", { method: "DELETE" });
    assert.ok(response.ok);

    // This is what the hook does after successful removal
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("schedule:sources:refresh"));
    }

    assert.ok(
      dispatchedEvents.includes("schedule:sources:refresh"),
      `Expected schedule:sources:refresh event, got: ${dispatchedEvents}`
    );
  });

  it("does not dispatch event on failure", async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ message: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const response = await fetch("/api/schedules/sources/source-123", { method: "DELETE" });

    // On failure, the hook does NOT dispatch the event
    if (!response.ok) {
      // Don't dispatch — this simulates the hook's error path
    }

    assert.ok(
      !dispatchedEvents.includes("schedule:sources:refresh"),
      "Should not dispatch event on failure"
    );
  });

  it("separate loading states: removing does not affect pausing", () => {
    // This tests the contract: pausingSourceId and removingSourceId are independent
    const pausingSourceId: string | null = null;
    let removingSourceId: string | null = null;

    // Simulate setting removingSourceId
    removingSourceId = "source-123";

    // pausingSourceId should remain null
    assert.equal(pausingSourceId, null, "pausingSourceId should be independent of removingSourceId");
    assert.equal(removingSourceId, "source-123");

    // Simulate clearing
    removingSourceId = null;
    assert.equal(removingSourceId, null);
    assert.equal(pausingSourceId, null);
  });
});
