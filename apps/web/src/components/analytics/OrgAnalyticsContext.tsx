"use client";

import { createContext, useContext, type ReactNode } from "react";

interface OrgAnalyticsData {
  orgId: string;
  orgType: string;
}

const OrgAnalyticsContext = createContext<OrgAnalyticsData | null>(null);

export function useOrgAnalytics(): OrgAnalyticsData | null {
  return useContext(OrgAnalyticsContext);
}

interface OrgAnalyticsProviderProps {
  orgId: string;
  orgType: string;
  children: ReactNode;
}

/**
 * Provides org identity to the analytics system without an extra DB query.
 * Rendered inside [orgSlug]/layout.tsx (server component), which already
 * fetches org data. AnalyticsProvider reads this context to set org context.
 */
export function OrgAnalyticsProvider({ orgId, orgType, children }: OrgAnalyticsProviderProps) {
  return (
    <OrgAnalyticsContext.Provider value={{ orgId, orgType }}>
      {children}
    </OrgAnalyticsContext.Provider>
  );
}
