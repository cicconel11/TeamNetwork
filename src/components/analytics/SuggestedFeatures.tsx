"use client";

import Link from "next/link";
import { Card } from "@/components/ui";
import { useUIProfile } from "@/lib/analytics/use-ui-profile";

interface SuggestedFeaturesProps {
  orgSlug: string;
}

/** Features that don't make sense as suggestion links. */
const HIDDEN_FEATURES = new Set(["other", "customization"]);

/** Map feature keys to their actual route paths. */
function featureToHref(orgSlug: string, feature: string): string {
  switch (feature) {
    case "dashboard":
      return `/${orgSlug}`;
    case "settings":
      return `/${orgSlug}/settings/invites`;
    case "navigation":
      return `/${orgSlug}/settings/navigation`;
    default:
      return `/${orgSlug}/${feature}`;
  }
}

/**
 * Client component that shows LLM-generated feature suggestions on the dashboard.
 * Renders nothing when there's no profile or no suggestions (graceful degradation).
 */
export function SuggestedFeatures({ orgSlug }: SuggestedFeaturesProps) {
  const { profile, loading } = useUIProfile();

  if (loading) return null;
  if (!profile) return null;

  const { dashboard_hints } = profile;
  if (!dashboard_hints.show_recent_features) return null;

  const suggested = dashboard_hints.suggested_features;
  if (!suggested || suggested.length === 0) return null;

  const visible = suggested.filter((f) => !HIDDEN_FEATURES.has(f));
  if (visible.length === 0) return null;

  return (
    <Card className="p-6 mb-6">
      <h2 className="font-semibold text-foreground mb-1">Explore More</h2>
      {dashboard_hints.preferred_time_label && (
        <p className="text-sm text-muted-foreground mb-4">{dashboard_hints.preferred_time_label}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {visible.map((feature) => (
          <Link
            key={feature}
            href={featureToHref(orgSlug, feature)}
            className="px-3 py-1.5 rounded-lg bg-muted text-sm font-medium text-foreground hover:bg-muted/80 transition-colors capitalize"
          >
            {feature}
          </Link>
        ))}
      </div>
    </Card>
  );
}
