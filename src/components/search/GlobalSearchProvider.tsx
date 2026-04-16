"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

export type GlobalSearchMode = "fast" | "ai";

type GlobalSearchContextValue = {
  orgSlug: string;
  orgId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  openSearch: () => void;
};

const GlobalSearchContext = createContext<GlobalSearchContextValue | null>(null);

export function useGlobalSearch() {
  const ctx = useContext(GlobalSearchContext);
  if (!ctx) {
    throw new Error("useGlobalSearch must be used within GlobalSearchProvider");
  }
  return ctx;
}

export function GlobalSearchProvider({
  orgSlug,
  orgId,
  children,
}: {
  orgSlug: string;
  orgId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("tn:open-global-search", onOpen as EventListener);
    return () => window.removeEventListener("tn:open-global-search", onOpen as EventListener);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.isComposing) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      ) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openSearch = useCallback(() => setOpen(true), []);

  const value = useMemo(
    () => ({ orgSlug, orgId, open, setOpen, openSearch }),
    [orgSlug, orgId, open, openSearch],
  );

  return <GlobalSearchContext.Provider value={value}>{children}</GlobalSearchContext.Provider>;
}
