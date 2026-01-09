"use client";

import { useHeroEntrance, useScrollReveal, useStaggeredReveal } from "@/components/marketing/use-animations";

export function AppPageAnimations() {
  // Hero section entrance animations for header and welcome text
  useHeroEntrance(".app-hero-animate");

  // Scroll-triggered reveal animations
  useScrollReveal(".app-scroll-reveal");

  // Staggered reveal for organization cards grid
  useStaggeredReveal(".orgs-grid", ".org-card");

  return null;
}
