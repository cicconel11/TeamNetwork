"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { trackBehavioralEvent } from "@/lib/analytics/events";

interface DirectoryCardLinkProps {
  href: string;
  organizationId: string;
  directoryType: "active_members" | "alumni";
  children: ReactNode;
}

export function DirectoryCardLink({ href, organizationId, directoryType, children }: DirectoryCardLinkProps) {
  return (
    <Link
      href={href}
      onClick={() => {
        trackBehavioralEvent("profile_card_open", {
          directory_type: directoryType,
          open_source: "list",
        }, organizationId);
      }}
    >
      {children}
    </Link>
  );
}
