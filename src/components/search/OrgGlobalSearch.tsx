"use client";

import type { ReactNode } from "react";
import { GlobalSearchProvider } from "./GlobalSearchProvider";
import { GlobalSearchPalette } from "./GlobalSearchPalette";

export function OrgGlobalSearch({
  orgSlug,
  orgId,
  children,
}: {
  orgSlug: string;
  orgId: string;
  children: ReactNode;
}) {
  return (
    <GlobalSearchProvider orgSlug={orgSlug} orgId={orgId}>
      {children}
      <GlobalSearchPalette />
    </GlobalSearchProvider>
  );
}
