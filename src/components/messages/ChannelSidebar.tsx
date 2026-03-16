"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/Badge";

interface ChatGroupItem {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  updated_at?: string | null;
}

interface ThreadItem {
  id: string;
  title: string;
  is_pinned: boolean;
  is_locked: boolean;
  reply_count: number;
  last_activity_at: string;
}

interface ChannelSidebarProps {
  chatGroups: ChatGroupItem[];
  discussionThreads: ThreadItem[];
  orgSlug: string;
  isAdmin: boolean;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SectionHeader({
  label,
  isOpen,
  onToggle,
}: {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
      <svg
        className={`h-3 w-3 transition-transform duration-200 ${isOpen ? "rotate-0" : "-rotate-90"}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

export function ChannelSidebar({
  chatGroups,
  discussionThreads,
  orgSlug,
  isAdmin,
}: ChannelSidebarProps) {
  const pathname = usePathname();
  const [channelsOpen, setChannelsOpen] = useState(true);
  const [threadsOpen, setThreadsOpen] = useState(true);

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <h2 className="font-semibold text-foreground text-sm">Messages</h2>
      </div>

      {/* Scrollable channel list */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Discussions section — renders discussion threads */}
        <SectionHeader
          label="Discussions"
          isOpen={channelsOpen}
          onToggle={() => setChannelsOpen(!channelsOpen)}
        />
        <div
          className="grid transition-[grid-template-rows] duration-200"
          style={{ gridTemplateRows: channelsOpen ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            {discussionThreads.map((thread) => {
              const href = `/${orgSlug}/messages/threads/${thread.id}`;
              const isActive = pathname === href;
              return (
                <Link
                  key={thread.id}
                  href={href}
                  className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "border-l-2 border-[var(--color-org-secondary)] bg-muted/50 text-foreground"
                      : "border-l-2 border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                  }`}
                >
                  <div className="flex-1 min-w-0 flex items-center gap-1">
                    {thread.is_pinned && (
                      <svg className="h-3 w-3 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L11 4.323V3a1 1 0 011-1z" />
                      </svg>
                    )}
                    {thread.is_locked && (
                      <svg className="h-3 w-3 text-muted-foreground flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    <span className="truncate">{thread.title}</span>
                  </div>
                  {thread.reply_count > 0 && (
                    <Badge variant="muted" className="text-[10px] px-1.5 py-0">
                      {thread.reply_count}
                    </Badge>
                  )}
                </Link>
              );
            })}
            {discussionThreads.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No discussions yet</p>
            )}
          </div>
        </div>

        {/* Chats section — renders chat groups */}
        <div className="mt-2">
          <SectionHeader
            label="Chats"
            isOpen={threadsOpen}
            onToggle={() => setThreadsOpen(!threadsOpen)}
          />
          <div
            className="grid transition-[grid-template-rows] duration-200"
            style={{ gridTemplateRows: threadsOpen ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              {chatGroups.map((group) => {
                const href = `/${orgSlug}/messages/chat/${group.id}`;
                const isActive = pathname === href;
                return (
                  <Link
                    key={group.id}
                    href={href}
                    className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? "border-l-2 border-[var(--color-org-secondary)] bg-muted/50 text-foreground"
                        : "border-l-2 border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                    }`}
                  >
                    <svg className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span className="flex-1 truncate font-medium">{group.name}</span>
                    {group.updated_at && (
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {formatRelativeTime(group.updated_at)}
                      </span>
                    )}
                  </Link>
                );
              })}
              {chatGroups.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">No chats yet</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="border-t border-border p-2 space-y-1">
        <Link
          href={`/${orgSlug}/messages/threads/new`}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted/30"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Discussion
        </Link>
        {isAdmin && (
          <Link
            href={`/${orgSlug}/messages/chat/new`}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted/30"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Chat
          </Link>
        )}
      </div>
    </div>
  );
}
