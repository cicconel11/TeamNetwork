"use client";

import { useCallback, useEffect, useRef } from "react";

const CONFIRM_MESSAGE = "You have unsaved changes. Leave this page?";

export interface UseUnsavedChangesWarningReturn {
  /**
   * Synchronously disables the warning for the remainder of the component's
   * life. Call this immediately before an intentional hard navigation (e.g.
   * `window.location.href = checkoutUrl`) — a state update cannot reliably
   * unregister the `beforeunload` handler before the browser fires it.
   */
  suppress: () => void;
}

/**
 * Warns the user before navigating away while `isDirty` is true.
 *
 * Covers two navigation classes:
 * - Hard navigations (tab close, reload, external links) via `beforeunload`.
 * - In-app navigations via a capture-phase click listener on internal
 *   anchors, because the Next.js App Router exposes no route-change
 *   blocking API.
 *
 * Programmatic navigation (`router.push` / `router.replace` / `router.back`)
 * is intentionally NOT intercepted: forms should clear their dirty flag (or
 * call `suppress()`) before navigating away after a successful submit.
 */
export function useUnsavedChangesWarning(
  isDirty: boolean,
): UseUnsavedChangesWarningReturn {
  const suppressedRef = useRef(false);

  const suppress = useCallback(() => {
    suppressedRef.current = true;
  }, []);

  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (suppressedRef.current) return;
      event.preventDefault();
      // Chrome requires returnValue to be set for the dialog to appear.
      event.returnValue = "";
    };

    const handleClick = (event: MouseEvent) => {
      if (suppressedRef.current) return;
      // Only the primary button with no modifier keys — anything else opens
      // a new tab/window and doesn't navigate this page.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      const anchor =
        target instanceof Element ? target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      // Cross-origin links cause a full unload — beforeunload handles those.
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;

      // Same-page navigations (hash changes etc.) don't lose form state.
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      ) {
        return;
      }

      if (!window.confirm(CONFIRM_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    // Capture phase so this runs before next/link's own click handler.
    document.addEventListener("click", handleClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, true);
    };
  }, [isDirty]);

  return { suppress };
}
