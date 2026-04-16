"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Button, Badge, ToggleSwitch } from "@/components/ui";
import { RecentDuesTable } from "./RecentDuesTable";
import { PurposeDotLeaders } from "./PurposeDotLeaders";
import { DonationDrawer } from "./DonationDrawer";
import { buildDonationPurposeTotals } from "@/lib/payments/donation-purpose-totals";
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
  hideDonorNames?: boolean;
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
  hideDonorNames: initialHideDonorNames = false,
}: PhilanthropyDashboardClientProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSimulatingPublic, setIsSimulatingPublic] = useState(false);
  const [hideDonorNames, setHideDonorNames] = useState(initialHideDonorNames);
  const [isSavingPrivacy, setIsSavingPrivacy] = useState(false);
  const tDonations = useTranslations("donations");

  const SETTLED_STATUSES = ["succeeded", "recorded"];

  const activePurposeTotals = isSimulatingPublic
    ? buildDonationPurposeTotals(
        donations.filter((d) => (d.visibility || "public") === "public" && SETTLED_STATUSES.includes(d.status)),
        tDonations("generalSupport"),
      )
    : purposeTotals;

  const handleToggleDonorPrivacy = async (checked: boolean) => {
    setIsSavingPrivacy(true);
    try {
      const res = await fetch(`/api/organizations/${organizationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hide_donor_names: checked }),
      });
      if (res.ok) {
        setHideDonorNames(checked);
      }
    } finally {
      setIsSavingPrivacy(false);
    }
  };

  return (
    <>
      {/* Admin controls bar */}
      {isAdmin && (
        <div className="mb-6 rounded-xl bg-muted/50 border border-border overflow-hidden">
          {/* Top row: Simulate toggle + Stripe status */}
          <div className="flex items-center justify-between p-3">
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
              <Badge
                variant={isStripeConnected ? "success" : "warning"}
                className={isStripeConnected ? "badge-success-muted" : ""}
              >
                {isStripeConnected ? tDonations("stripeConnected") : tDonations("setupRequired")}
              </Badge>
            </div>
          </div>

          {/* Donor privacy row */}
          <div className="flex items-center justify-between px-3 py-2.5 border-t border-border/50">
            <div className="flex items-center gap-3">
              <ToggleSwitch
                checked={hideDonorNames}
                onChange={handleToggleDonorPrivacy}
                disabled={isSavingPrivacy}
                size="sm"
                label={tDonations("hideDonorNames")}
              />
              <div className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
                <span className="text-sm text-muted-foreground">{tDonations("hideDonorNames")}</span>
              </div>
            </div>
            {isSavingPrivacy && (
              <span className="text-xs text-muted-foreground animate-pulse">{tDonations("saving")}</span>
            )}
            {!isSavingPrivacy && hideDonorNames && (
              <Badge variant="muted">
                <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
                {tDonations("donorPrivacy")}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Main content grid — hide Recent Dues card entirely when simulating public + donor privacy */}
      {isSimulatingPublic && hideDonorNames ? (
        <div className="mb-8">
          <Card className="p-5">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
              {tDonations("byPurpose")}
            </h3>
            <PurposeDotLeaders
              purposeTotals={activePurposeTotals}
              emptyMessage={purposeEmptyMessage}
            />
          </Card>
        </div>
      ) : (
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
              translations={{
                noDonationsYet: tDonations("noDonationsYet"),
                donor: tDonations("donor"),
                purpose: tDonations("purpose"),
                date: tDonations("date"),
                amount: tDonations("amount"),
                status: tDonations("status"),
                visibility: tDonations("visibility"),
                anonymous: tDonations("anonymous"),
                generalSupport: tDonations("generalSupport"),
                visibilitySupporterOnly: tDonations("visibilitySupporterOnly"),
                visibilityPrivate: tDonations("visibilityPrivate"),
              }}
            />
          </Card>

          {/* Purpose Breakdown */}
          <Card className="p-5">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
              {tDonations("byPurpose")}
            </h3>
            <PurposeDotLeaders
              purposeTotals={activePurposeTotals}
              emptyMessage={purposeEmptyMessage}
            />
          </Card>
        </div>
      )}

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
