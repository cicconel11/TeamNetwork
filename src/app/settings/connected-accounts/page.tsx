"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui";
import { LinkedInSettingsPanel } from "@/components/settings/LinkedInSettingsPanel";
import { useLinkedIn } from "@/hooks/useLinkedIn";

export default function ConnectedAccountsPage() {
  return (
    <Suspense fallback={<ConnectedAccountsLoading />}>
      <ConnectedAccountsContent />
    </Suspense>
  );
}

function ConnectedAccountsLoading() {
  const tSettings = useTranslations("settings");
  const tCommon = useTranslations("common");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{tSettings("title")}</p>
        <h1 className="text-2xl font-bold text-foreground">{tSettings("connectedAccounts.title")}</h1>
        <p className="text-muted-foreground">
          {tSettings("connectedAccounts.description")}
        </p>
      </div>
      <Card className="p-5 text-muted-foreground text-sm">{tCommon("loading")}</Card>
    </div>
  );
}

function ConnectedAccountsContent() {
  const tSettings = useTranslations("settings");
  const linkedIn = useLinkedIn();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{tSettings("title")}</p>
        <h1 className="text-2xl font-bold text-foreground">{tSettings("connectedAccounts.title")}</h1>
        <p className="text-muted-foreground">
          {tSettings("connectedAccounts.description")}
        </p>
      </div>

      <LinkedInSettingsPanel
        linkedInUrl={linkedIn.linkedInUrl}
        onLinkedInUrlSave={linkedIn.onLinkedInUrlSave}
        connection={linkedIn.connection}
        isConnected={linkedIn.isConnected}
        connectionLoading={linkedIn.connectionLoading}
        oauthAvailable={linkedIn.oauthAvailable}
        brightDataConfigured={linkedIn.brightDataConfigured}
        resyncEnabled={linkedIn.resyncEnabled}
        resyncIsAdmin={linkedIn.resyncIsAdmin}
        resyncRemaining={linkedIn.resyncRemaining}
        resyncMaxPerMonth={linkedIn.resyncMaxPerMonth}
        onConnect={linkedIn.onConnect}
        onOauthSync={linkedIn.onOauthSync}
        onBrightDataSync={linkedIn.onBrightDataSync}
        onDisconnect={linkedIn.onDisconnect}
      />

      <Card className="p-5 space-y-3">
        <p className="font-medium text-foreground">{tSettings("connectedAccounts.googleCalTitle")}</p>
        <p className="text-sm text-muted-foreground">
          {tSettings("connectedAccounts.googleCalDesc")}
        </p>
      </Card>
    </div>
  );
}
