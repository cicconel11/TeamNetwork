"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Button, Badge, ToggleSwitch } from "@/components/ui";
import { RecentDuesTable } from "./RecentDuesTable";
import { PurposeDotLeaders } from "./PurposeDotLeaders";
import { DonationDrawer } from "./DonationDrawer";
import type { OrganizationDonation } from "@/types/database";

interface PhilanthropyDashboardClientProps {
  organizationId: string;
  organizationSlug: string;
  isAdmin: boolean;
  isStripeConnected: boolean;
  donations: OrganizationDonation[];
  purposeTotals: Record<string, number>;
  philanthropyEventsForForm: { id: string; title: string }[];
  purposeEmptyMessage: string;
}

export function PhilanthropyDashboardClient({
  organizationId,
  organizationSlug,
  isAdmin,
  isStripeConnected,
  donations,
  purposeTotals,
  philanthropyEventsForForm,
  purposeEmptyMessage,
}: PhilanthropyDashboardClientProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSimulatingPublic, setIsSimulatingPublic] = useState(false);
  const tDonations = useTranslations("donations");

  return (
    <>
      {/* Admin controls bar */}
      {isAdmin && (
        <div className="flex items-center justify-between mb-6 p-3 rounded-xl bg-muted/50 border border-border">
          <div className="flex items-center gap-3">
            <ToggleSwitch
              checked={isSimulatingPublic}
              onChange={setIsSimulatingPublic}
              size="sm"
              label={tDonations("simulatePublic")}
            />
            <span className="text-sm text-muted-foreground">{tDonations("simulatePublic")}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isStripeConnected ? "success" : "warning"}>
              {isStripeConnected ? tDonations("stripeConnected") : tDonations("setupRequired")}
            </Badge>
          </div>
        </div>
      )}

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Recent Dues Table */}
        <Card padding="none" className="lg:col-span-2 overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">{tDonations("recentDues")}</h3>
          </div>
          <RecentDuesTable
            donations={donations}
            isAdmin={isAdmin}
            isPublicView={isSimulatingPublic}
          />
        </Card>

        {/* Purpose Breakdown */}
        <Card className="p-5">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
            {tDonations("byPurpose")}
          </h3>
          <PurposeDotLeaders
            purposeTotals={purposeTotals}
            emptyMessage={purposeEmptyMessage}
          />
        </Card>
      </div>

      {/* Make a Donation button (floating in header via portal would be ideal, but keeping it simple) */}
      <Button onClick={() => setIsDrawerOpen(true)} disabled={!isStripeConnected}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {tDonations("makeADonation")}
      </Button>

      {/* Donation Drawer */}
      <DonationDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        organizationId={organizationId}
        organizationSlug={organizationSlug}
        philanthropyEventsForForm={philanthropyEventsForForm}
        isStripeConnected={isStripeConnected}
      />
    </>
  );
}
