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

  return (
    <button
      onClick={togglePanel}
      aria-label={isOpen ? "Close AI assistant" : "Open AI assistant"}
      className={`rounded-md text-gray-400 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
        showLabel
          ? "flex w-full items-center gap-3 px-3 py-2.5 text-sm font-medium"
          : "flex items-center justify-center p-2"
      }`}
    >
      <Sparkles className="h-5 w-5" />
      {showLabel ? <span>AI Assistant</span> : null}
    </button>
  );
}
