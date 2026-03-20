"use client";

import { Sparkles } from "lucide-react";
import { useAIPanel } from "./AIPanelContext";

interface AIAssistantToggleProps {
  isAdmin: boolean;
}

export function AIAssistantToggle({ isAdmin }: AIAssistantToggleProps) {
  const { togglePanel, isOpen } = useAIPanel();

  if (!isAdmin) return null;

  return (
    <button
      onClick={togglePanel}
      aria-label={isOpen ? "Close AI assistant" : "Open AI assistant"}
      className="flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
    >
      <Sparkles className="h-5 w-5" />
    </button>
  );
}
