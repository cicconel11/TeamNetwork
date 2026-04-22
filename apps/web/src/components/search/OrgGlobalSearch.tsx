"use client";

import type { ReactNode } from "react";
import { GlobalSearchProvider } from "./GlobalSearchProvider";
import { GlobalSearchPalette } from "./GlobalSearchPalette";

export function OrgGlobalSearch({
  orgSlug,
  orgId,
  currentProfileHref,
  children,
}: {
  orgSlug: string;
  orgId: string;
  currentProfileHref?: string;
  children: ReactNode;
}) {
  return (
    <GlobalSearchProvider orgSlug={orgSlug} orgId={orgId} currentProfileHref={currentProfileHref}>
      {children}
      <GlobalSearchPalette />
    </GlobalSearchProvider>
  );
}
