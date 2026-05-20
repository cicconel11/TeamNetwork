"use client";

import dynamic from "next/dynamic";

// SSR'd: components are "use client" but only touch window/document inside useEffect,
// so server render matches the initial client tree. Removing the dynamic() indirection
// gets their HTML into the first RSC payload instead of waiting for hydration.
export { FAQAccordion } from "@/components/marketing/FAQAccordion";
export { HeroOrgCard } from "@/components/marketing/HeroOrgCard";
export { LandingHeader } from "@/components/marketing/LandingHeader";
export { BackToTop } from "@/components/marketing/BackToTop";
export { FeaturesGrid } from "@/components/marketing/FeaturesGrid";

// Animation-only chunks stay client-only — they pull framer-motion / anime.js
// and SSR'ing them would inflate the critical RSC payload without LCP benefit.
export const LandingAnimations = dynamic(
  () => import("@/components/marketing/LandingAnimations").then((mod) => mod.LandingAnimations),
  { ssr: false },
);

export const StadiumLightBeams = dynamic(
  () => import("@/components/marketing/StadiumLightBeams").then((mod) => mod.StadiumLightBeams),
  { ssr: false },
);

export const Confetti = dynamic(
  () => import("@/components/marketing/Confetti").then((mod) => mod.Confetti),
  { ssr: false },
);

export const BackgroundPaths = dynamic(
  () => import("@/components/marketing/BackgroundPaths").then((mod) => mod.BackgroundPaths),
  { ssr: false },
);
