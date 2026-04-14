"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

interface HoverSidebarContext {
  isExpanded: boolean;
  isPinned: boolean;
  togglePin: () => void;
}

interface HoverSidebarProps {
  storageKey: string;
  forceExpanded?: boolean;
  layout?: "fixed" | "static";
  className?: string;
  children: (ctx: HoverSidebarContext) => ReactNode;
}

const COLLAPSED_OFFSET = "3.5rem";
const EXPANDED_OFFSET = "16rem";

function writeOffset(pinned: boolean) {
  if (typeof document === "undefined") return;
  if (pinned) {
    document.documentElement.style.setProperty("--sidebar-offset", EXPANDED_OFFSET);
  } else {
    document.documentElement.style.setProperty("--sidebar-offset", COLLAPSED_OFFSET);
  }
}

function clearOffset() {
  if (typeof document === "undefined") return;
  document.documentElement.style.removeProperty("--sidebar-offset");
}

export function HoverSidebar({
  storageKey,
  forceExpanded = false,
  layout = "fixed",
  className = "",
  children,
}: HoverSidebarProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    if (forceExpanded) return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "1") {
        setIsPinned(true);
        writeOffset(true);
      } else {
        writeOffset(false);
      }
    } catch {
      writeOffset(false);
    }
    return () => {
      clearOffset();
    };
  }, [storageKey, forceExpanded]);

  const togglePin = useCallback(() => {
    setIsPinned((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // ignore quota / privacy errors
      }
      writeOffset(next);
      if (!next) {
        setIsHovered(false);
        setIsFocused(false);
      }
      return next;
    });
  }, [storageKey]);

  const isExpanded = forceExpanded || isPinned || isHovered || isFocused;

  const positionClass =
    layout === "fixed" ? "fixed left-0 top-0 h-screen z-40" : "relative h-full";
  const widthClass = forceExpanded
    ? "w-64"
    : "w-14 data-[expanded=true]:w-64";

  return (
    <aside
      data-expanded={isExpanded}
      onMouseEnter={forceExpanded ? undefined : () => setIsHovered(true)}
      onMouseLeave={forceExpanded ? undefined : () => setIsHovered(false)}
      onFocusCapture={forceExpanded ? undefined : () => setIsFocused(true)}
      onBlurCapture={
        forceExpanded
          ? undefined
          : (e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setIsFocused(false);
              }
            }
      }
      className={`flex flex-col bg-card border-r border-border overflow-hidden transition-[width] duration-300 ease-in-out motion-reduce:transition-none ${positionClass} ${widthClass} ${className}`}
    >
      {children({ isExpanded, isPinned, togglePin })}
    </aside>
  );
}

interface PinButtonProps {
  isPinned: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  className?: string;
}

export function PinButton({ isPinned, isExpanded, onToggle, className = "" }: PinButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isPinned ? "Unpin sidebar" : "Pin sidebar"}
      aria-pressed={isPinned}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-[opacity,color,background-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
        isExpanded ? "opacity-100" : "opacity-0 pointer-events-none"
      } ${className}`}
      tabIndex={isExpanded ? 0 : -1}
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill={isPinned ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={1.75}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 4.5l4.5 4.5-4.95 1.65-3.3 3.3-1.2 4.05L5.25 12 9.3 10.8l3.3-3.3L15 4.5zM9.75 14.25L4.5 19.5"
        />
      </svg>
    </button>
  );
}
