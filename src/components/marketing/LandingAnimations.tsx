"use client";

import { useHeroEntrance, useScrollReveal, useSectionPop, useStaggeredReveal } from "./use-animations";

export function LandingAnimations() {
  // Hero section entrance animations
  useHeroEntrance(".hero-animate");

  // Scroll-triggered reveal animations with fallback
  useScrollReveal(".scroll-reveal");

  // Enhanced pop animations for pricing cards
  useSectionPop(".pricing-card");

  // Staggered reveal for feature grids
  useStaggeredReveal(".features-grid", ".trophy-card");
  useStaggeredReveal(".terms-grid", ".terms-card");

  return null;
}

