"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeRole } from "@/lib/auth/role-utils";
import type { UserRole } from "@/types/database";
import { Card } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { BlackbaudSettingsPanel } from "@/components/settings/BlackbaudSettingsPanel";
import { showFeedback } from "@/lib/feedback/show-feedback";

interface IntegrationRow {
  id: string;
  status: string;
  last_synced_at: string | null;
  last_sync_count: number | null;
  last_sync_error: { phase: string; code: string; message: string; at: string } | null;
}

interface SyncLogRow {
  status: string;
  records_created: number | null;
  records_updated: number | null;
  records_unchanged: number | null;
  records_skipped: number | null;
  completed_at: string | null;
}

export default function IntegrationsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const orgSlug = params.orgSlug as string;
  const supabase = useMemo(() => createClient(), []);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [integration, setIntegration] = useState<IntegrationRow | null>(null);
  const [lastSyncLog, setLastSyncLog] = useState<SyncLogRow | null>(null);
  const [blackbaudAvailable, setBlackbaudAvailable] = useState(false);

  // Handle OAuth callback URL params
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");

    if (success === "blackbaud_connected") {
      showFeedback("Blackbaud connected successfully!", "success", { duration: 5000 });
    } else if (error) {
      const messages: Record<string, string> = {
        blackbaud_oauth_denied: "Blackbaud authorization was denied.",
        blackbaud_invalid_callback: "Invalid callback from Blackbaud.",
        blackbaud_invalid_state: "Invalid OAuth state. Please try again.",
        blackbaud_state_reused: "This authorization link has already been used.",
        blackbaud_user_mismatch: "User mismatch. Please try connecting again.",
        blackbaud_state_expired: "Authorization expired. Please try again.",
        blackbaud_access_revoked: "You no longer have admin access to this organization.",
        blackbaud_admin_check_failed: "Could not verify admin access. Please try again.",
        blackbaud_verify_failed: "Could not verify Blackbaud API access.",
        blackbaud_exchange_failed: "Failed to exchange authorization code.",
        session_expired: "Your session expired. Please log in and try again.",
      };
      showFeedback(messages[error] || `Connection error: ${error}`, "error", { duration: 8000 });
    }
  }, [searchParams]);

  // Bootstrap: fetch org, membership, integration data
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setPageError(null);

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .maybeSingle();

      if (!org || orgError) {
        setPageError("Organization not found.");
        setLoading(false);
        return;
      }

      setOrgId(org.id);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setPageError("You must be signed in.");
        setLoading(false);
        return;
      }

      const { data: membership } = await supabase
        .from("user_organization_roles")
        .select("status, role")
        .eq("organization_id", org.id)
        .eq("user_id", user.id)
        .maybeSingle();

      const normalizedRole = normalizeRole((membership?.role as UserRole | null) ?? null);

      if (!membership || membership.status !== "active" || normalizedRole !== "admin") {
        setPageError("Admin access required to manage integrations.");
        setLoading(false);
        return;
      }

      // Fetch Blackbaud integration
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: integrationRow } = await (supabase as any)
        .from("org_integrations")
        .select("id, status, last_synced_at, last_sync_count, last_sync_error")
        .eq("organization_id", org.id)
        .eq("provider", "blackbaud")
        .maybeSingle();

      setIntegration(integrationRow || null);

      // Fetch latest sync log if integration exists
      if (integrationRow?.id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: syncLog } = await (supabase as any)
          .from("integration_sync_log")
          .select("status, records_created, records_updated, records_unchanged, records_skipped, completed_at")
          .eq("integration_id", integrationRow.id)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        setLastSyncLog(syncLog || null);
      }

      // Check if Blackbaud is configured in this environment
      try {
        const statusRes = await fetch("/api/blackbaud/status");
        const statusData = await statusRes.json();
        setBlackbaudAvailable(statusData.configured === true);
      } catch {
        setBlackbaudAvailable(false);
      }

      setLoading(false);
    };

    load();
  }, [orgSlug, supabase]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Connect external services to sync data with your organization."
        backHref={`/${orgSlug}/customization`}
      />

      {pageError ? (
        <Card className="p-5 text-red-600 dark:text-red-400 text-sm">{pageError}</Card>
      ) : (
        <BlackbaudSettingsPanel
          orgSlug={orgSlug}
          orgId={orgId || ""}
          integration={
            integration
              ? {
                  status: integration.status as "active" | "error" | "disconnected",
                  lastSyncedAt: integration.last_synced_at,
                  lastSyncCount: integration.last_sync_count,
                  lastSyncError: integration.last_sync_error,
                }
              : null
          }
          lastSyncLog={
            lastSyncLog
              ? {
                  status: lastSyncLog.status,
                  recordsCreated: lastSyncLog.records_created ?? 0,
                  recordsUpdated: lastSyncLog.records_updated ?? 0,
                  recordsUnchanged: lastSyncLog.records_unchanged ?? 0,
                  recordsSkipped: lastSyncLog.records_skipped ?? 0,
                  completedAt: lastSyncLog.completed_at,
                }
              : null
          }
          loading={loading}
          blackbaudAvailable={blackbaudAvailable}
        />
      )}
    </div>
  );
}
