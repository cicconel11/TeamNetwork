"use client";

import { useState } from "react";
import Link from "next/link";

interface MembersFilterProps {
  orgSlug: string;
  currentStatus?: string;
  currentRole?: string;
  roles: Array<string | null>;
}

export function MembersFilter({ orgSlug, currentStatus, currentRole, roles }: MembersFilterProps) {
  const [open, setOpen] = useState(false);

  const buildHref = (status?: string, role?: string) => {
    const params = new URLSearchParams();
    if (status && status !== "active") params.set("status", status);
    if (role) params.set("role", role);
    const query = params.toString();
    return query ? `/${orgSlug}/members?${query}` : `/${orgSlug}/members`;
  };

  const statusItems = [
    { label: "Active", value: "active" },
    { label: "Inactive", value: "inactive" },
    { label: "All statuses", value: undefined },
  ];

  const roleItems = [
    { label: "All roles", value: undefined },
    ...roles
      .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      .map((r) => ({ label: r, value: r })),
  ];

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-border transition-colors"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
        </svg>
        Filter
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute mt-2 w-52 rounded-xl border border-border bg-card shadow-lg z-10">
          <div className="py-2">
            <p className="px-4 pb-2 text-xs text-muted-foreground uppercase tracking-wide">Status</p>
            {statusItems.map((item) => {
              const active = (currentStatus || "active") === (item.value || "active");
              return (
                <Link
                  key={item.label}
                  href={buildHref(item.value, currentRole)}
                  className={`block px-4 py-2 text-sm transition-colors ${
                    active ? "text-white bg-org-primary" : "text-foreground hover:bg-muted"
                  }`}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              );
            })}

            <div className="h-px bg-border my-2" />

            <p className="px-4 pb-2 text-xs text-muted-foreground uppercase tracking-wide">Role</p>
            {roleItems.map((item) => {
              const active = (currentRole ?? "") === (item.value ?? "");
              return (
                <Link
                  key={item.label}
                  href={buildHref(currentStatus, item.value)}
                  className={`block px-4 py-2 text-sm transition-colors ${
                    active ? "text-white bg-org-primary" : "text-foreground hover:bg-muted"
                  }`}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
