"use client";

import type { ComponentType } from "react";
import {
  ArrowRightLeft,
  BarChart3,
  ClipboardList,
  FileText,
  Pencil,
  Search,
  UserCheck,
  Users,
} from "lucide-react";

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
    id: "compare-people",
    label: "Compare people",
    prompt: "Compare the top two mentor matches for [member name].",
    icon: ArrowRightLeft,
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
    id: "review-proposals",
    label: "Review mentorship proposals",
    prompt: "Review pending mentorship proposals and summarize each one.",
    icon: ClipboardList,
  },
  {
    id: "incomplete-profiles",
    label: "Find incomplete profiles",
    prompt: "Show members with incomplete profiles.",
    icon: Users,
  },
  {
    id: "analyze-engagement",
    label: "Analyze engagement",
    prompt: "Analyze this organization's engagement over the past month.",
    icon: BarChart3,
  },
];

interface AssistantWorkflowShortcutsProps {
  activeWorkflowId: string | null;
  disabled?: boolean;
  onSelect: (shortcut: AssistantWorkflowShortcut) => void;
}

export function AssistantWorkflowShortcuts({
  activeWorkflowId,
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
          const isActive = activeWorkflowId === shortcut.id;
          return (
            <button
              key={shortcut.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(shortcut)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-50 ${
                isActive
                  ? "bg-org-secondary/10 font-medium text-org-secondary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
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
