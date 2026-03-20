"use client";

import { Sparkles } from "lucide-react";
import { useAIPanel } from "./AIPanelContext";

interface AIAssistantToggleProps {
  isAdmin: boolean;
  showLabel?: boolean;
}

export function AIAssistantToggle({ isAdmin, showLabel = false }: AIAssistantToggleProps) {
  const { togglePanel, isOpen } = useAIPanel();

  if (!isAdmin) return null;

  const handleClick = () => {
    togglePanel();
  };

  if (showLabel) {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={isOpen ? "Close AI assistant" : "Open AI assistant"}
        aria-pressed={isOpen}
        className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
          isOpen
            ? "bg-indigo-600/15 text-indigo-500 ring-1 ring-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-400 dark:ring-indigo-400/20"
            : "text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.98]"
        }`}
      >
        <Sparkles className={`h-5 w-5 ${isOpen ? "text-indigo-500 dark:text-indigo-400" : ""}`} />
        <span className="flex-1 text-left">AI Assistant</span>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
          isOpen
            ? "bg-indigo-500/20 text-indigo-500 dark:text-indigo-400"
            : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-400"
        }`}>
          Beta
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={isOpen ? "Close AI assistant" : "Open AI assistant"}
      aria-pressed={isOpen}
      className={`flex cursor-pointer items-center justify-center rounded-lg p-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
        isOpen
          ? "bg-indigo-600/15 text-indigo-500 ring-1 ring-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-400 dark:ring-indigo-400/20"
          : "text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.98]"
      }`}
    >
      <Sparkles className="h-5 w-5" />
    </button>
  );
}
