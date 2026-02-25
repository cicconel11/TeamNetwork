"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { OrgSidebar } from "./OrgSidebar";
import type { Organization } from "@/types/database";
import type { OrgRole } from "@/lib/auth/role-utils";

interface MobileNavProps {
  organization: Organization;
  role: OrgRole | null;
  isDevAdmin?: boolean;
  hasAlumniAccess?: boolean;
  hasParentsAccess?: boolean;
}

export function MobileNav({ organization, role, isDevAdmin = false, hasAlumniAccess = false, hasParentsAccess = false }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const basePath = `/${organization.slug}`;

  // Prevent caching issues by forcing re-render of menu when open state changes
  const toggleMenu = () => setIsOpen(!isOpen);
  const closeMenu = () => setIsOpen(false);

  return (
    <>
      {/* Top Bar (Mobile Only) */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-card border-b border-border z-30 flex items-center justify-between px-4">
        <Link href={basePath} className="flex items-center gap-3 min-w-0">
          {organization.logo_url ? (
            <div className="relative h-8 w-8 rounded-lg overflow-hidden">
              <Image
                src={organization.logo_url}
                alt={organization.name}
                fill
                className="object-cover"
                sizes="32px"
              />
            </div>
          ) : (
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
              style={{ backgroundColor: "var(--color-org-primary)" }}
            >
              {organization.name.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <span className="font-semibold text-foreground truncate max-w-[200px] block">{organization.name}</span>
            {isDevAdmin && (
              <span className="text-[10px] uppercase tracking-wide text-purple-400 block">Dev Admin</span>
            )}
          </div>
        </Link>

        <button
          onClick={toggleMenu}
          className="p-2 -mr-2 text-muted-foreground hover:text-foreground"
          aria-label="Toggle menu"
        >
          {isOpen ? (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          )}
        </button>
      </header>

      {/* Drawer Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={closeMenu}
          aria-hidden="true"
        />
      )}

      {/* Slide-out Drawer */}
      <div
        className={`fixed top-0 bottom-0 left-0 w-64 bg-card z-50 transform transition-transform duration-300 ease-in-out lg:hidden ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <OrgSidebar
          organization={organization}
          role={role}
          isDevAdmin={isDevAdmin}
          hasAlumniAccess={hasAlumniAccess}
          hasParentsAccess={hasParentsAccess}
          className="h-full border-r border-border"
          onClose={closeMenu}
        />
      </div>
    </>
  );
}
