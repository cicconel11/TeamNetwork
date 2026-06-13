"use client";

import { usePathname } from "next/navigation";
import { useAIPanel } from "@/components/ai-assistant/AIPanelContext";
import { isFullPageAssistantRoute } from "@/components/ai-assistant/route-surface";

interface OrgMainContentProps {
  children: React.ReactNode;
  hasTopBanner: boolean;
}

export function OrgMainContent({ children, hasTopBanner }: OrgMainContentProps) {
  const pathname = usePathname();
  const { isOpen: aiPanelOpen } = useAIPanel();
  const isAssistant = isFullPageAssistantRoute(pathname);
  // Full-bleed routes manage their own height and padding; the drawer is
  // suppressed on the assistant route, so its margin must not apply there.
  const isFullBleed = pathname.includes("/messages") || isAssistant;
  const reserveDrawerMargin = aiPanelOpen && !isAssistant;

  return (
    <main
      className={`lg:ml-[var(--sidebar-offset,3.5rem)] transition-[margin] duration-300 ease-in-out motion-reduce:transition-none ${reserveDrawerMargin ? "lg:mr-[420px]" : ""} ${isFullBleed ? "h-[calc(100dvh-4rem)] lg:h-dvh overflow-hidden pt-16 lg:pt-0" : "p-4 lg:p-8 pt-20 lg:pt-8"} ${hasTopBanner ? "mt-12" : ""}`}
    >
      {children}
    </main>
  );
}
