"use client";

import { useEffect, useRef } from "react";
import { DonationForm } from "@/components/donations";

interface DonationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  organizationSlug: string;
  philanthropyEventsForForm?: { id: string; title: string }[];
  isStripeConnected?: boolean;
}

export function DonationDrawer({
  isOpen,
  onClose,
  organizationId,
  organizationSlug,
  philanthropyEventsForForm,
  isStripeConnected,
}: DonationDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.addEventListener("mousedown", handleClickOutside);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleClickOutside);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div
        ref={drawerRef}
        className="absolute right-0 top-0 h-full w-full max-w-lg bg-card border-l border-border shadow-xl animate-slide-in-right"
      >
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Make a Donation</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 overflow-y-auto h-[calc(100%-80px)]">
          <DonationForm
            organizationId={organizationId}
            organizationSlug={organizationSlug}
            philanthropyEventsForForm={philanthropyEventsForForm}
            isStripeConnected={isStripeConnected}
          />
        </div>
      </div>
    </div>
  );
}
