"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { trackBehavioralEvent } from "@/lib/analytics/events";

interface DirectoryCardLinkProps {
  href: string;
  organizationId: string;
  directoryType: "active_members" | "alumni" | "parents";
  className?: string;
  children: ReactNode;
}

export function DirectoryCardLink({
  href,
  organizationId,
  directoryType,
  className = "",
  children,
}: DirectoryCardLinkProps) {
  return (
    <Link
      href={href}
      className={className}
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
