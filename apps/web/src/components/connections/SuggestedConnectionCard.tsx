"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import type {
  ConnectionMatchStrength,
  DisplayReadySuggestedConnection,
} from "@/lib/people-graph/scoring";

export interface SuggestedConnectionCardLabels {
  message: string;
  opening: string;
  strengthStrong: string;
  strengthGood: string;
  strengthSuggested: string;
  errorGeneric: string;
  notOnApp: string;
}

interface SuggestedConnectionCardProps {
  suggestion: DisplayReadySuggestedConnection;
  orgId: string;
  orgSlug: string;
  labels: SuggestedConnectionCardLabels;
}

const STRENGTH_DOT: Record<ConnectionMatchStrength, string> = {
  strong: "bg-emerald-500",
  good: "bg-sky-500",
  suggested: "bg-violet-400",
};

const STRENGTH_TEXT: Record<ConnectionMatchStrength, string> = {
  strong: "text-emerald-600",
  good: "text-sky-600",
  suggested: "text-violet-500",
};

// Per-tier card identity so even a weak (grad-year-only) match reads as designed
// rather than flat grey. Strong/good get a clear tint + ring; suggested gets a
// quiet violet wash that still feels intentional.
const STRENGTH_CARD: Record<ConnectionMatchStrength, string> = {
  strong: "border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-card",
  good: "border-sky-200 bg-gradient-to-br from-sky-50/70 to-card",
  suggested: "border-violet-100 bg-gradient-to-br from-violet-50/40 to-card",
};

// Colored avatar ring per tier — the cheapest way to add life to every card.
const STRENGTH_RING: Record<ConnectionMatchStrength, string> = {
  strong: "ring-2 ring-emerald-300/70 ring-offset-2 ring-offset-card",
  good: "ring-2 ring-sky-300/70 ring-offset-2 ring-offset-card",
  suggested: "ring-2 ring-violet-200 ring-offset-2 ring-offset-card",
};

/**
 * One scored connection suggestion: avatar, name, human subtitle, a match-strength
 * signal, value-rich reason chips, and a Message action.
 *
 * The Message button posts to the existing direct-chat/profile route via fetch and
 * reads back the `{ chatGroupId }` JSON, then soft-navigates into the thread with
 * router.push — no full-page reload or cold re-render (the old form POST → 303 cost
 * 5-6s on a cold chat page). The route still re-resolves person_id → user_id and
 * re-checks chat eligibility / networking consent server-side.
 */
export function SuggestedConnectionCard({
  suggestion,
  orgId,
  orgSlug,
  labels,
}: SuggestedConnectionCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const messagesBase = `/${orgSlug}/messages`;

  // Warm the destination route so the post-fetch soft nav is instant.
  useEffect(() => {
    router.prefetch(messagesBase);
  }, [router, messagesBase]);

  const strengthLabel: Record<ConnectionMatchStrength, string> = {
    strong: labels.strengthStrong,
    good: labels.strengthGood,
    suggested: labels.strengthSuggested,
  };

  const openChat = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/organizations/${orgId}/direct-chat/profile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // No orgSlug → the route returns JSON { chatGroupId } instead of a 303.
          body: JSON.stringify({
            profileType: suggestion.person_type,
            profileId: suggestion.person_id,
          }),
        });

        if (!res.ok) {
          setError(labels.errorGeneric);
          return;
        }

        const data = (await res.json()) as { chatGroupId?: string };
        if (!data.chatGroupId) {
          setError(labels.errorGeneric);
          return;
        }

        router.push(`${messagesBase}/chat/${data.chatGroupId}`);
      } catch {
        setError(labels.errorGeneric);
      }
    });
  };

  return (
    <Card
      padding="sm"
      className={`group relative flex flex-col gap-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${STRENGTH_CARD[suggestion.strength]}`}
    >
      <span
        className={`absolute right-4 top-4 inline-flex items-center gap-1.5 text-[11px] font-semibold ${STRENGTH_TEXT[suggestion.strength]}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${STRENGTH_DOT[suggestion.strength]}`} />
        {strengthLabel[suggestion.strength]}
      </span>

      <div className="flex items-start gap-3 pr-24">
        <Avatar
          src={null}
          name={suggestion.name}
          size="md"
          className={STRENGTH_RING[suggestion.strength]}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{suggestion.name}</p>
          {suggestion.subtitle && (
            <p className="truncate text-xs text-muted-foreground">{suggestion.subtitle}</p>
          )}
        </div>
      </div>

      {suggestion.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestion.reasons.map((reason) => (
            <span
              key={reason.code}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] leading-none ${
                reason.strong
                  ? "border-emerald-200 bg-emerald-50 font-semibold text-emerald-700"
                  : "border-border bg-muted/60 font-medium text-muted-foreground"
              }`}
            >
              <span className={reason.detail ? "opacity-70" : ""}>{reason.label}</span>
              {reason.detail && <span>· {reason.detail}</span>}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-1.5">
        {suggestion.messageable ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={openChat}
              isLoading={isPending}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  {labels.opening}
                </>
              ) : (
                <>
                  <MessageCircle className="mr-1.5 h-4 w-4" />
                  {labels.message}
                </>
              )}
            </Button>
            {error && (
              <p className="text-center text-xs font-medium text-destructive" role="alert">
                {error}
              </p>
            )}
          </>
        ) : (
          // Unclaimed profile (no in-app account) — messaging would 409, so we show
          // a quiet status instead of a dead button.
          <p className="rounded-xl border border-border bg-muted/40 py-2 text-center text-xs font-medium text-muted-foreground">
            {labels.notOnApp}
          </p>
        )}
      </div>
    </Card>
  );
}
