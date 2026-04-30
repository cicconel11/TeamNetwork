"use client";

import dynamic from "next/dynamic";

export const AIPanel = dynamic(
  () => import("@/components/ai-assistant/AIPanel").then((module) => module.AIPanel),
  { ssr: false },
);

export const AIEdgeTab = dynamic(
  () => import("@/components/ai-assistant/AIEdgeTab").then((module) => module.AIEdgeTab),
  { ssr: false },
);
