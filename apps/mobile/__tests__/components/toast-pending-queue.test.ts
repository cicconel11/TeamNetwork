/**
 * Pending-toast queue: toasts requested before ToastBridge wires a real handler
 * (e.g. an early-boot deep link at launch) must be queued and flushed in order,
 * not dropped. Regression guard for the single-slot overwrite that silently lost
 * all but the most recent early-launch toast.
 *
 * Targets the pure `toast-queue` module directly (Toast.tsx re-exports it) so
 * no native RN deps load in the node test env.
 */
import { showToast, setGlobalShowToast } from "@/components/ui/toast-queue";

afterEach(() => {
  // Detach the handler so the next test starts with an empty queue + no handler.
  setGlobalShowToast(null);
});

describe("showToast pending queue", () => {
  it("forwards directly to a wired handler without queueing", () => {
    const handler = jest.fn();
    setGlobalShowToast(handler);

    showToast("hello", "success");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("hello", "success", undefined);
  });

  it("queues every pre-handler request and flushes them in order (no drop)", () => {
    // No handler yet — these must be buffered, not lost.
    showToast("first", "error");
    showToast("second", "error");
    showToast("third", "info");

    const handler = jest.fn();
    setGlobalShowToast(handler);

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler.mock.calls.map((c) => c[0])).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("does not re-flush already-drained toasts when a new handler attaches", () => {
    showToast("once", "error");

    const first = jest.fn();
    setGlobalShowToast(first);
    expect(first).toHaveBeenCalledTimes(1);

    // Re-wiring (e.g. bridge remount) must not replay the drained queue.
    const second = jest.fn();
    setGlobalShowToast(second);
    expect(second).not.toHaveBeenCalled();
  });

  it("preserves the action payload through the queue", () => {
    const onPress = jest.fn();
    showToast("retryable", "error", { label: "Try again", onPress });

    const handler = jest.fn();
    setGlobalShowToast(handler);

    expect(handler).toHaveBeenCalledWith("retryable", "error", {
      label: "Try again",
      onPress,
    });
  });
});
