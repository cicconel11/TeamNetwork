"use client";

import { FEATURES } from "@/lib/pricing";
import { FeatureIcon } from "./icons";
import { CursorCard, CursorCardsContainer } from "./CursorCards";

export function FeaturesGrid() {
  return (
    <CursorCardsContainer className="features-grid bento-grid" proximityRange={500}>
      {FEATURES.map((feature, i) => (
        <CursorCard
          key={feature.title}
          className="overflow-hidden"
        >
          <div className="p-6">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-landing-cream/10 to-landing-cream/5">
              <FeatureIcon index={i} />
            </div>
            <h3 className="mb-2 font-display text-lg font-semibold text-landing-cream">
              {feature.title}
            </h3>
            <p className="text-sm leading-relaxed text-landing-cream/50">
              {feature.description}
            </p>
          </div>
        </CursorCard>
      ))}
    </CursorCardsContainer>
  );
}
