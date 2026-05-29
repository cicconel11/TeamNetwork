"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { JumpBackInData } from "@/lib/feed/load-jump-back-in";

interface JumpBackInProps {
  orgId: string;
  data: JumpBackInData;
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/** Builds the "3 new posts · 2 event RSVPs · 1 new member" segment list. */
function buildSegments(data: JumpBackInData): string[] {
  const segments: string[] = [];
  if (data.newPosts > 0) segments.push(pluralize(data.newPosts, "new post"));
  if (data.newRsvps > 0) segments.push(pluralize(data.newRsvps, "event RSVP"));
  if (data.newMembers > 0) segments.push(pluralize(data.newMembers, "new member"));
  return segments;
}

/**
 * "Jump back in" digest strip. Shows activity since the member last acknowledged
 * the feed. Both "Catch up" and dismiss advance `feed_last_seen_at` (via
 * /api/feed/seen) so the strip clears on next load. The acknowledge call is
 * best-effort: on failure we still hide the strip locally to avoid a stuck UI,
 * but log so a persistent failure is visible server-side.
 */
export function JumpBackIn({ orgId, data }: JumpBackInProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  const segments = buildSegments(data);
  if (hidden || segments.length === 0) return null;

  async function acknowledge(refresh: boolean) {
    setHidden(true);
    try {
      const res = await fetch("/api/feed/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (!res.ok) {
        console.error("[JumpBackIn] mark-seen failed:", res.status);
      }
    } catch (err) {
      console.error("[JumpBackIn] mark-seen request error:", err);
    }
    if (refresh) startTransition(() => router.refresh());
  }

  return (
    <div className="mb-5 flex items-center gap-3 rounded-xl border border-org-secondary/25 bg-org-secondary/[0.07] px-4 py-3">
      <span
        className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-org-secondary"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-sm text-foreground">
        <span className="font-semibold">Since your last visit: </span>
        {segments.map((segment, i) => (
          <span key={segment}>
            {i > 0 && <span className="text-border" aria-hidden="true"> · </span>}
            <span className="font-semibold text-org-secondary-dark">{segment}</span>
          </span>
        ))}
      </p>
      <button
        type="button"
        onClick={() => acknowledge(true)}
        disabled={pending}
        className="shrink-0 whitespace-nowrap text-sm font-semibold text-org-primary transition-colors hover:text-org-primary-dark disabled:opacity-60"
      >
        Catch up <span aria-hidden="true">→</span>
      </button>
      <button
        type="button"
        onClick={() => acknowledge(false)}
        aria-label="Dismiss"
        className="-mr-1 shrink-0 rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
