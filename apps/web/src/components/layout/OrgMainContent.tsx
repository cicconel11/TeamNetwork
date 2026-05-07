"use client";

import { usePathname } from "next/navigation";
import { useAIPanel } from "@/components/ai-assistant/AIPanelContext";

interface OrgMainContentProps {
  children: React.ReactNode;
  hasTopBanner: boolean;
}

export function OrgMainContent({ children, hasTopBanner }: OrgMainContentProps) {
  const pathname = usePathname();
  const { isOpen: aiPanelOpen } = useAIPanel();
  const isMessages = pathname.includes("/messages");

  return (
    <main
      className={`lg:ml-[var(--sidebar-offset,3.5rem)] transition-[margin] duration-300 ease-in-out motion-reduce:transition-none ${aiPanelOpen ? "lg:mr-[420px]" : ""} ${isMessages ? "h-[calc(100dvh-4rem)] lg:h-dvh overflow-hidden pt-16 lg:pt-0" : "p-4 lg:p-8 pt-20 lg:pt-8"} ${hasTopBanner ? "mt-12" : ""}`}
    >
      {children}
    </main>
  );
}
