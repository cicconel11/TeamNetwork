"use client";

import dynamic from "next/dynamic";

export const AIPanel = dynamic(
  () => import("@/components/ai-assistant/AIPanel").then((m) => m.AIPanel),
  { ssr: false },
);

export const AIEdgeTab = dynamic(
  () => import("@/components/ai-assistant/AIEdgeTab").then((m) => m.AIEdgeTab),
  { ssr: false },
);

export const OrgGlobalSearch = dynamic(
  () => import("@/components/search/OrgGlobalSearch").then((m) => m.OrgGlobalSearch),
  { ssr: false },
);
