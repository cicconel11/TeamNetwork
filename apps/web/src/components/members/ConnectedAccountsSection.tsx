"use client";

import { Suspense, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LinkedInSettingsPanel } from "@/components/settings/LinkedInSettingsPanel";
import { GoogleCalendarSyncPanel } from "@/components/settings/GoogleCalendarSyncPanel";
import { OutlookCalendarSyncPanel } from "@/components/settings/OutlookCalendarSyncPanel";
import { LinkedInIcon } from "@/components/shared/LinkedInIcon";
import { Badge } from "@/components/ui/Badge";
import { useGoogleCalendarSync } from "@/hooks/useGoogleCalendarSync";
import { useOutlookCalendarSync } from "@/hooks/useOutlookCalendarSync";
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

/**
 * A single collapsible service row. Collapsed by default so the whole section
 * stays short and connection status is scannable at a glance; the full
 * settings panel only renders when the row is expanded.
 */
function AccountRow({
  icon,
  name,
  connected,
  loading,
  children,
  statusConnectedLabel,
  statusNotConnectedLabel,
}: {
  icon: ReactNode;
  name: string;
  connected: boolean;
  loading: boolean;
  children: ReactNode;
  statusConnectedLabel: string;
  statusNotConnectedLabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--muted)]/40"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--muted)]/50">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{name}</span>
        {!loading &&
          (connected ? (
            <Badge variant="success" className="shrink-0">
              {statusConnectedLabel}
            </Badge>
          ) : (
            <Badge variant="muted" className="shrink-0">
              {statusNotConnectedLabel}
            </Badge>
          ))}
        <svg
          className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-border [&>.card]:rounded-none [&>.card]:border-0 [&>.card]:shadow-none">
          {children}
        </div>
      )}
    </div>
  );
}

/** Microsoft Outlook brand glyph (four-square logo), matching the panel header. */
function OutlookGlyph() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="1" fill="#F25022" />
      <rect x="13" y="3" width="8" height="8" rx="1" fill="#7FBA00" />
      <rect x="3" y="13" width="8" height="8" rx="1" fill="#00A4EF" />
      <rect x="13" y="13" width="8" height="8" rx="1" fill="#FFB900" />
    </svg>
  );
}

/** Calendar glyph for the Google Calendar row. */
function CalendarGlyph() {
  return (
    <svg
      className="h-5 w-5 text-foreground"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0V11.25A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
      />
    </svg>
  );
}

function ConnectedAccountsSectionContent({
  orgSlug,
  orgId,
  orgName,
}: ConnectedAccountsSectionProps) {
  const pathname = usePathname();
  const t = useTranslations("connectedAccounts");
  const linkedIn = useLinkedIn({ redirectPath: pathname ?? undefined });

  const calendarSync = useGoogleCalendarSync({
    orgId,
    orgSlug,
    redirectPath: pathname ?? undefined,
  });

  const outlookSync = useOutlookCalendarSync({
    orgId,
    orgSlug,
    redirectPath: pathname ?? undefined,
  });

  // LinkedIn counts as connected if either the OAuth connection is live or the
  // member has saved a profile URL others can find them by.
  const linkedInConnected = linkedIn.isConnected || Boolean(linkedIn.linkedInUrl);
  const googleConnected = calendarSync.isConnected && !calendarSync.reconnectRequired;
  const outlookConnected = outlookSync.isConnected && !outlookSync.reconnectRequired;

  const statusConnected = t("statusConnected");
  const statusNotConnected = t("statusNotConnected");

  return (
    <section className="mt-8" aria-labelledby="connected-accounts-heading">
      <h3 id="connected-accounts-heading" className="mb-1 font-semibold text-foreground">
        {t("title")}
      </h3>
      <p className="mb-4 text-sm text-muted-foreground">{t("subtitle")}</p>
      <div className="space-y-3">
        <AccountRow
          icon={<LinkedInIcon />}
          name={t("linkedin")}
          connected={linkedInConnected}
          loading={linkedIn.connectionLoading}
          statusConnectedLabel={statusConnected}
          statusNotConnectedLabel={statusNotConnected}
        >
          <LinkedInSettingsPanel
            nested
            linkedInUrl={linkedIn.linkedInUrl}
            onLinkedInUrlSave={linkedIn.onLinkedInUrlSave}
            connection={linkedIn.connection}
            isConnected={linkedIn.isConnected}
            connectionLoading={linkedIn.connectionLoading}
            oauthAvailable={linkedIn.oauthAvailable}
            enrichmentConfigured={linkedIn.enrichmentConfigured}
            resyncEnabled={linkedIn.resyncEnabled}
            resyncIsAdmin={linkedIn.resyncIsAdmin}
            resyncRemaining={linkedIn.resyncRemaining}
            resyncMaxPerMonth={linkedIn.resyncMaxPerMonth}
            onConnect={linkedIn.onConnect}
            onSync={linkedIn.onSync}
            onDisconnect={linkedIn.onDisconnect}
          />
        </AccountRow>

        <AccountRow
          icon={<CalendarGlyph />}
          name={t("googleCalendar")}
          connected={googleConnected}
          loading={calendarSync.connectionLoading}
          statusConnectedLabel={statusConnected}
          statusNotConnectedLabel={statusNotConnected}
        >
          <GoogleCalendarSyncPanel
            nested
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
        </AccountRow>

        <AccountRow
          icon={<OutlookGlyph />}
          name={t("outlook")}
          connected={outlookConnected}
          loading={outlookSync.connectionLoading}
          statusConnectedLabel={statusConnected}
          statusNotConnectedLabel={statusNotConnected}
        >
          <OutlookCalendarSyncPanel
            nested
            orgName={orgName}
            organizationId={orgId}
            connection={outlookSync.connection}
            isConnected={outlookSync.isConnected}
            connectionLoading={outlookSync.connectionLoading}
            calendars={outlookSync.calendars}
            calendarsLoading={outlookSync.calendarsLoading}
            targetCalendarId={outlookSync.targetCalendarId}
            preferences={outlookSync.preferences}
            preferencesLoading={outlookSync.preferencesLoading}
            reconnectRequired={outlookSync.reconnectRequired}
            onConnect={outlookSync.connect}
            onDisconnect={outlookSync.disconnect}
            onSync={outlookSync.syncNow}
            onReconnect={outlookSync.reconnect}
            onTargetCalendarChange={outlookSync.setTargetCalendar}
            onPreferenceChange={outlookSync.updatePreferences}
          />
        </AccountRow>
      </div>
    </section>
  );
}
