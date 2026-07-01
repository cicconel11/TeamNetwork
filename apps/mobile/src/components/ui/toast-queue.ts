/**
 * Global toast dispatch + pre-mount queue.
 *
 * Pure (no React / native imports) so it is unit-testable in the node jest env
 * and so `showToast` can be called from non-component code (deep-link routing,
 * early-boot handlers). `Toast.tsx` wires the real handler via
 * `setGlobalShowToast` once `ToastBridge` mounts and re-exports these for the
 * app's existing `@/components/ui/Toast` import sites.
 */

export type ToastVariant = "success" | "error" | "warning" | "info";

export type ToastAction = { label: string; onPress: () => void };

export type GlobalShowToast = (
  message: string,
  variant?: ToastVariant,
  action?: ToastAction
) => void;

let globalShowToast: GlobalShowToast | null = null;

// If a toast is requested before ToastBridge mounts (e.g. an early-boot deep
// link processed by Linking.getInitialURL() at launch), globalShowToast is null
// and the call would be a silent no-op. Queue requests and flush them in order
// once a real handler is wired, so an early-launch failure isn't lost. We queue
// every pending request (not just the last) so a burst — e.g. a failed deep-link
// consume plus a follow-up error — doesn't drop all but the most recent.
const pendingToasts: Parameters<GlobalShowToast>[] = [];

export function setGlobalShowToast(fn: GlobalShowToast | null) {
  globalShowToast = fn;
  if (fn && pendingToasts.length > 0) {
    // Drain into a local copy first so a handler that re-enters showToast
    // (re-queuing during flush) doesn't mutate the array we're iterating.
    const queued = pendingToasts.splice(0, pendingToasts.length);
    for (const args of queued) {
      fn(...args);
    }
  }
}

export function showToast(
  message: string,
  variant: ToastVariant = "success",
  action?: ToastAction
) {
  if (globalShowToast) {
    globalShowToast(message, variant, action);
    return;
  }
  pendingToasts.push([message, variant, action]);
}
