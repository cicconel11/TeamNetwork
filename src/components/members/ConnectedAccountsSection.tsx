"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import {
  LinkedInSettingsPanel,
} from "@/components/settings/LinkedInSettingsPanel";
import { GoogleCalendarSyncPanel } from "@/components/settings/GoogleCalendarSyncPanel";
import { useGoogleCalendarSync } from "@/hooks/useGoogleCalendarSync";
import { useLinkedIn } from "@/hooks/useLinkedIn";

interface ConnectedAccountsSectionProps {
  orgSlug: string;
  orgId: string;
  orgName: string;
}

export function ConnectedAccountsSection(props: ConnectedAccountsSectionProps) {
  return (
    <Suspense fallback={null}>
      <ConnectedAccountsSectionContent {...props} />
    </Suspense>
  );
}

function ConnectedAccountsSectionContent({
  orgSlug,
  orgId,
  orgName,
}: ConnectedAccountsSectionProps) {
  const pathname = usePathname();
  const linkedIn = useLinkedIn({ redirectPath: pathname ?? undefined });

  const calendarSync = useGoogleCalendarSync({
    orgId,
    orgSlug,
    redirectPath: pathname ?? undefined,
  });

  return (
    <section className="mt-8">
      <h3 className="font-semibold text-foreground mb-4">Connected Accounts</h3>
      <div className="space-y-6">
        <LinkedInSettingsPanel
          linkedInUrl={linkedIn.linkedInUrl}
          onLinkedInUrlSave={linkedIn.onLinkedInUrlSave}
          connection={linkedIn.connection}
          isConnected={linkedIn.isConnected}
          connectionLoading={linkedIn.connectionLoading}
          oauthAvailable={linkedIn.oauthAvailable}
          resyncEnabled={linkedIn.resyncEnabled}
          resyncRemaining={linkedIn.resyncRemaining}
          resyncMaxPerMonth={linkedIn.resyncMaxPerMonth}
          onConnect={linkedIn.onConnect}
          onSync={linkedIn.onSync}
          onDisconnect={linkedIn.onDisconnect}
        />
        <GoogleCalendarSyncPanel
          orgName={orgName}
          organizationId={orgId}
          connection={calendarSync.connection}
          isConnected={calendarSync.isConnected}
          connectionLoading={calendarSync.connectionLoading}
          calendars={calendarSync.calendars}
          calendarsLoading={calendarSync.calendarsLoading}
          targetCalendarId={calendarSync.targetCalendarId}
          preferences={calendarSync.preferences}
          preferencesLoading={calendarSync.preferencesLoading}
          reconnectRequired={calendarSync.reconnectRequired}
          onConnect={calendarSync.connect}
          onDisconnect={calendarSync.disconnect}
          onSync={calendarSync.syncNow}
          onReconnect={calendarSync.reconnect}
          onTargetCalendarChange={calendarSync.setTargetCalendar}
          onPreferenceChange={calendarSync.updatePreferences}
        />
      </div>
    </section>
  );
}
