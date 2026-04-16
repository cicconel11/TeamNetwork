"use client";

import { Sparkles } from "lucide-react";
import { useAIPanel } from "./AIPanelContext";

interface AIEdgeTabProps {
  isAdmin: boolean;
}

export function AIEdgeTab({ isAdmin }: AIEdgeTabProps) {
  const { isOpen, togglePanel } = useAIPanel();

  if (!isAdmin) return null;

  return (
    <button
      type="button"
      onClick={togglePanel}
      aria-label={isOpen ? "Close AI assistant" : "Open AI assistant"}
      aria-expanded={isOpen}
      className={`ai-edge-tab fixed top-1/3 right-0 z-[44] flex flex-col items-center gap-1.5 rounded-l-2xl bg-org-secondary px-2.5 py-3.5 text-org-secondary-foreground shadow-[-4px_0_12px_rgba(0,0,0,0.1)] transition-all duration-200 hover:bg-org-secondary-dark hover:shadow-[-4px_0_16px_rgba(0,0,0,0.15)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-org-secondary focus-visible:ring-offset-1 ${
        isOpen
          ? "pointer-events-none translate-x-full opacity-0"
          : "translate-x-0 opacity-100"
      }`}
    >
      <Sparkles className="h-4 w-4" />
      <span className="text-[10px] font-semibold tracking-widest [writing-mode:vertical-rl] rotate-180">
        AI
      </span>
    </button>
  );
}
