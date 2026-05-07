"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState } from "@/components/ui";

interface MatchReason {
  code: string;
  label: string;
}

interface MatchSuggestion {
  mentor: {
    user_id: string;
    name: string;
    subtitle: string | null;
  };
  reasons: MatchReason[];
  qualityTier?: "strong" | "good" | "possible";
}

interface MentorshipMyMatchesProps {
  organizationId: string;
  organizationSlug: string;
  userId: string;
  hasIntakeSubmission: boolean;
}

export function MentorshipMyMatches({
  organizationId,
  organizationSlug,
  userId,
  hasIntakeSubmission,
}: MentorshipMyMatchesProps) {
  const [matches, setMatches] = useState<MatchSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const safeT = (t: ReturnType<typeof useTranslations>, key: string, fallback: string) => {
    try { return t(key); } catch { return fallback; }
  };
  const tMentorship = useTranslations("mentorship");

  useEffect(() => {
    if (!hasIntakeSubmission) {
      setLoading(false);
      return;
    }

    async function loadMatches() {
      try {
        const res = await fetch(
          `/api/organizations/${organizationId}/mentorship/suggestions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mentee_user_id: userId,
              limit: 10,
            }),
          }
        );

        if (!res.ok) {
          throw new Error("Failed to load matches");
        }

        const data = await res.json();
        setMatches(data.matches ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load matches");
      } finally {
        setLoading(false);
      }
    }

    loadMatches();
  }, [organizationId, userId, hasIntakeSubmission]);

  if (!hasIntakeSubmission) {
    return (
      <EmptyState
        title={safeT(tMentorship, "myMatchesNoIntake", "Complete your intake form")}
        description={safeT(tMentorship, "myMatchesNoIntakeDesc", "Fill out the mentorship intake form so we can find your best mentor matches.")}
        action={
          <a href={`/${organizationSlug}/mentorship?tab=directory`}>
            <Button size="sm">{safeT(tMentorship, "goToDirectory", "Go to Directory")}</Button>
          </a>
        }
      />
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-lg border border-border p-5">
            <div className="h-5 w-48 bg-muted rounded mb-3" />
            <div className="h-4 w-32 bg-muted rounded mb-2" />
            <div className="flex gap-2 mt-3">
              <div className="h-6 w-24 bg-muted rounded-full" />
              <div className="h-6 w-20 bg-muted rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30">
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <EmptyState
        title={safeT(tMentorship, "noMatchesFound", "No matches found yet")}
        description={safeT(tMentorship, "noMatchesFoundDesc", "We haven't found strong mentor matches for you yet. Check back as more mentors join.")}
      />
    );
  }

  const tierVariant = (tier?: string): "success" | "primary" | "muted" => {
    if (tier === "strong") return "success";
    if (tier === "good") return "primary";
    return "muted";
  };

  const tierLabel = (tier?: string): string => {
    if (tier === "strong") return safeT(tMentorship, "strongMatch", "Strong match");
    if (tier === "good") return safeT(tMentorship, "goodMatch", "Good match");
    return safeT(tMentorship, "possibleMatch", "Possible match");
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground mb-4">
        {safeT(tMentorship, "myMatchesDescription", "Mentors matched to your profile and preferences. Request an intro to connect.")}
      </p>

      {matches.map((match) => (
        <div
          key={match.mentor.user_id}
          className="rounded-lg border border-border p-5 hover:border-foreground/20 transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-foreground truncate">
                  {match.mentor.name}
                </h3>
                {match.qualityTier && (
                  <Badge variant={tierVariant(match.qualityTier)}>
                    {tierLabel(match.qualityTier)}
                  </Badge>
                )}
              </div>
              {match.mentor.subtitle && (
                <p className="text-sm text-muted-foreground truncate">
                  {match.mentor.subtitle}
                </p>
              )}
            </div>
            <a href={`/${organizationSlug}/mentorship?tab=directory`}>
              <Button size="sm" variant="secondary">
                {safeT(tMentorship, "requestIntro", "Request Intro")}
              </Button>
            </a>
          </div>

          {match.reasons.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {match.reasons.map((reason, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-muted/60 text-muted-foreground"
                >
                  {reason.label}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
