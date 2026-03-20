"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import {
  AI_PANEL_PREFERENCE_KEY,
  resolveInitialAIPanelOpen,
  type AIPanelPreference,
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

function persistPreference(preference: AIPanelPreference) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AI_PANEL_PREFERENCE_KEY, preference);
}

export function AIPanelProvider({ children, autoOpen = false }: AIPanelProviderProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!autoOpen || typeof window === "undefined") {
      return;
    }

    const persisted = window.localStorage.getItem(AI_PANEL_PREFERENCE_KEY);
    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;

    setIsOpen(
      resolveInitialAIPanelOpen({
        isAdmin: autoOpen,
        isDesktop,
        persisted,
      })
    );
  }, [autoOpen]);

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      persistPreference(next ? "open" : "closed");
      return next;
    });
  }, []);

  const closePanel = useCallback(() => {
    persistPreference("closed");
    setIsOpen(false);
  }, []);

  return (
    <AIPanelContext.Provider value={{ isOpen, togglePanel, closePanel }}>
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
