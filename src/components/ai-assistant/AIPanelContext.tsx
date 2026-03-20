"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface AIPanelState {
  isOpen: boolean;
  togglePanel: () => void;
  closePanel: () => void;
}

const AIPanelContext = createContext<AIPanelState | null>(null);

export function AIPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const togglePanel = useCallback(() => setIsOpen(prev => !prev), []);
  const closePanel = useCallback(() => setIsOpen(false), []);

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
