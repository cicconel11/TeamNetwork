"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  AI_PANEL_PREFERENCE_KEY,
  resolveInitialAIPanelOpen,
} from "./panel-preferences";

interface AIPanelState {
  isOpen: boolean;
  togglePanel: () => void;
  closePanel: () => void;
}

const AIPanelContext = createContext<AIPanelState | null>(null);

interface AIPanelProviderProps {
  children: ReactNode;
  autoOpen?: boolean;
}

export function AIPanelProvider({ children, autoOpen = false }: AIPanelProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    if (!autoOpen || typeof window === "undefined") {
      return;
    }

    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    const storedPreference = window.localStorage.getItem(AI_PANEL_PREFERENCE_KEY);

    setIsOpen(
      resolveInitialAIPanelOpen({
        isAdmin: autoOpen,
        isDesktop,
        storedPreference,
      })
    );
  }, [autoOpen]);

  useEffect(() => {
    if (!isMounted.current || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      AI_PANEL_PREFERENCE_KEY,
      isOpen ? "open" : "closed"
    );
  }, [isOpen]);

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const closePanel = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <AIPanelContext.Provider value={{ isOpen: isMounted.current ? isOpen : false, togglePanel, closePanel }}>
      {children}
    </AIPanelContext.Provider>
  );
}

export function useAIPanel(): AIPanelState {
  const ctx = useContext(AIPanelContext);
  if (!ctx) {
    throw new Error("useAIPanel must be used within AIPanelProvider");
  }
  return ctx;
}
