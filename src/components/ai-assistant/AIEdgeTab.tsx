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
      className={`ai-edge-tab fixed top-1/3 right-0 z-[44] flex flex-col items-center gap-1.5 rounded-l-xl bg-indigo-600 px-2 py-3 text-white shadow-[-2px_0_8px_rgba(0,0,0,0.15)] transition-all duration-200 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
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
