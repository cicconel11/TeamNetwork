"use client";

import type { ComponentType } from "react";
import { BarChart3, FileText, Pencil, Search, UserCheck } from "lucide-react";

export interface AssistantWorkflowShortcut {
  id: string;
  label: string;
  /** Prompt pre-filled into the message input when the shortcut is selected. */
  prompt: string;
  icon: ComponentType<{ className?: string }>;
}

export const ASSISTANT_WORKFLOW_SHORTCUTS: AssistantWorkflowShortcut[] = [
  {
    id: "suggest-mentors",
    label: "Suggest mentors",
    prompt: "Suggest mentors for [member name] and explain the ranking.",
    icon: UserCheck,
  },
  {
    id: "find-people",
    label: "Find people",
    prompt: "Find alumni who work in [industry].",
    icon: Search,
  },
  {
    id: "draft-message",
    label: "Draft a message",
    prompt: "Draft an intro message to [name] about mentorship.",
    icon: Pencil,
  },
  {
    id: "summarize-activity",
    label: "Summarize activity",
    prompt: "Summarize upcoming events and recent announcements.",
    icon: FileText,
  },
  {
    id: "analyze-engagement",
    label: "Analyze engagement",
    prompt: "Analyze this organization's engagement over the past month.",
    icon: BarChart3,
  },
];

interface AssistantWorkflowShortcutsProps {
  disabled?: boolean;
  onSelect: (shortcut: AssistantWorkflowShortcut) => void;
}

export function AssistantWorkflowShortcuts({
  disabled = false,
  onSelect,
}: AssistantWorkflowShortcutsProps) {
  return (
    <div className="border-b border-border/50 px-3 pb-3">
      <p className="mb-2 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        Workflows
      </p>
      <div className="space-y-0.5">
        {ASSISTANT_WORKFLOW_SHORTCUTS.map((shortcut) => {
          const Icon = shortcut.icon;
          return (
            <button
              key={shortcut.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(shortcut)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{shortcut.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
