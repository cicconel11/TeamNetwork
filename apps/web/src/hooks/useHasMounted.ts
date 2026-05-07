"use client";

import { useState, useEffect } from "react";

/**
 * Returns `false` during SSR and on first render, `true` after hydration.
 * Use to guard browser-only values (e.g. timezone-dependent dates) that
 * would cause React hydration mismatches if computed on the server.
 */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
