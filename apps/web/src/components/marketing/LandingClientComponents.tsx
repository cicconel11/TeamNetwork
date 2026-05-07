"use client";

import dynamic from "next/dynamic";

export const FAQAccordion = dynamic(
  () => import("@/components/marketing/FAQAccordion").then((mod) => mod.FAQAccordion),
  { ssr: false },
);

export const HeroOrgCard = dynamic(
  () => import("@/components/marketing/HeroOrgCard").then((mod) => mod.HeroOrgCard),
  { ssr: false },
);

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

export const LandingHeader = dynamic(
  () => import("@/components/marketing/LandingHeader").then((mod) => mod.LandingHeader),
  { ssr: false },
);

export const BackToTop = dynamic(
  () => import("@/components/marketing/BackToTop").then((mod) => mod.BackToTop),
  { ssr: false },
);

export const BackgroundPaths = dynamic(
  () => import("@/components/marketing/BackgroundPaths").then((mod) => mod.BackgroundPaths),
  { ssr: false },
);

export const FeaturesGrid = dynamic(
  () => import("@/components/marketing/FeaturesGrid").then((mod) => mod.FeaturesGrid),
  { ssr: false },
);
