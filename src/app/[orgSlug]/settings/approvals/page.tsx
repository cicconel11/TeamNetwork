"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout";
import { Button, Card, Badge } from "@/components/ui";
import { getRoleLabel } from "@/lib/auth/role-display";
import { formatShortDate } from "@/lib/utils/dates";

interface PendingMember {
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  users?: { name: string | null; email: string | null };
}

export default function ApprovalsPage() {
  const tApprovals = useTranslations("settings.approvals");
  const tCommon = useTranslations("common");
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([]);
  const [pendingAlumni, setPendingAlumni] = useState<PendingMember[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const PAGE_SIZE = 100;
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      const { data: orgs, error: orgError } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .limit(1);

      const org = orgs?.[0];

      if (org && !orgError) {
        setOrgId(org.id);

        const offset = page * PAGE_SIZE;
        const { data: memberships, count } = await supabase
          .from("user_organization_roles")
          .select("user_id, role, status, created_at, users(name, email)", { count: "exact" })
          .eq("organization_id", org.id)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        const pendingUserIds = (memberships ?? []).map((m) => m.user_id);

        const [{ data: memberRows }, { data: alumniRows }] = pendingUserIds.length
          ? await Promise.all([
              supabase
                .from("members")
                .select("user_id, first_name, last_name, email")
                .eq("organization_id", org.id)
                .in("user_id", pendingUserIds),
              supabase
                .from("alumni")
                .select("user_id, first_name, last_name, email")
                .eq("organization_id", org.id)
                .in("user_id", pendingUserIds),
            ])
          : [{ data: [] }, { data: [] }];

        const profileByUserId = new Map<string, { name: string | null; email: string | null }>();
        for (const row of [...(alumniRows ?? []), ...(memberRows ?? [])]) {
          if (!row.user_id) continue;
          const fullName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
          if (!profileByUserId.has(row.user_id)) {
            profileByUserId.set(row.user_id, {
              name: fullName || null,
              email: row.email ?? null,
            });
          }
        }

        const normalizedMemberships: PendingMember[] =
          memberships?.map((m) => {
            const user = Array.isArray(m.users) ? m.users[0] : m.users;
            const profile = profileByUserId.get(m.user_id);
            return {
              user_id: m.user_id,
              role: m.role,
              status: m.status,
              created_at: m.created_at,
              users: {
                name: user?.name ?? profile?.name ?? null,
                email: user?.email ?? profile?.email ?? null,
              },
            };
          }) || [];

        setPendingMembers(normalizedMemberships.filter(m => m.role === "active_member" || m.role === "admin"));
        setPendingAlumni(normalizedMemberships.filter(m => m.role === "alumni"));
        setTotalCount(count ?? 0);
      }

      setIsLoading(false);
    };

    fetchData();
  }, [orgSlug, page]);

  const handleApprove = async (userId: string) => {
    if (!orgId) return;
    const supabase = createClient();

    const { error: updateError } = await supabase
      .from("user_organization_roles")
      .update({ status: "active" })
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .eq("status", "pending");

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setPendingMembers((prev) => prev.filter((m) => m.user_id !== userId));
    setPendingAlumni((prev) => prev.filter((m) => m.user_id !== userId));
    setTotalCount((prev) => Math.max(0, prev - 1));
    if (totalPending === 1 && page > 0) {
      setPage((prev) => Math.max(0, prev - 1));
    }
  };

  const handleReject = async (userId: string) => {
    if (!orgId) return;
    if (!confirm(tApprovals("confirmReject"))) return;

    const supabase = createClient();

    const { error: deleteError } = await supabase
      .from("user_organization_roles")
      .delete()
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .eq("status", "pending");

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setPendingMembers((prev) => prev.filter((m) => m.user_id !== userId));
    setPendingAlumni((prev) => prev.filter((m) => m.user_id !== userId));
    setTotalCount((prev) => Math.max(0, prev - 1));
    if (totalPending === 1 && page > 0) {
      setPage((prev) => Math.max(0, prev - 1));
    }
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title={tApprovals("title")} description={tCommon("loading")} />
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  const totalPending = pendingMembers.length + pendingAlumni.length;

  return (
    <div>
      <PageHeader
        title={tApprovals("title")}
        description={tApprovals("description")}
        backHref={`/${orgSlug}/settings/invites`}
      />

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Pending Members Section */}
      <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        {tApprovals("pendingMembers")}
        {pendingMembers.length > 0 && (
          <Badge variant="warning">{pendingMembers.length}</Badge>
        )}
      </h2>

      {pendingMembers.length > 0 ? (
        <div className="space-y-3 mb-8">
          {pendingMembers.map((member) => (
            <Card key={member.user_id} className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="font-medium text-foreground">
                    {member.users?.name || member.users?.email || "Unknown User"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {member.users?.email}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {tApprovals("requested", { date: formatShortDate(member.created_at) })} • {getRoleLabel(member.role)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(member.user_id)}
                  >
                    {tCommon("approve")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600"
                    onClick={() => handleReject(member.user_id)}
                  >
                    {tCommon("reject")}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-6 text-center mb-8">
          <p className="text-sm text-muted-foreground">{tApprovals("noPendingMembers")}</p>
        </Card>
      )}

      {/* Pending Alumni Section */}
      <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        {tApprovals("pendingAlumni")}
        {pendingAlumni.length > 0 && (
          <Badge variant="warning">{pendingAlumni.length}</Badge>
        )}
      </h2>

      {pendingAlumni.length > 0 ? (
        <div className="space-y-3">
          {pendingAlumni.map((member) => (
            <Card key={member.user_id} className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="font-medium text-foreground">
                    {member.users?.name || member.users?.email || "Unknown User"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {member.users?.email}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {tApprovals("requested", { date: formatShortDate(member.created_at) })} • {getRoleLabel("alumni")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(member.user_id)}
                  >
                    {tCommon("approve")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600"
                    onClick={() => handleReject(member.user_id)}
                  >
                    {tCommon("reject")}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">{tApprovals("noPendingAlumni")}</p>
        </Card>
      )}

      {totalPending === 0 && (
        <div className="mt-8 text-center">
          <div className="h-16 w-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
            <svg className="h-8 w-8 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-muted-foreground">{tApprovals("allCaughtUp")}</p>
          <Link
            href={`/${orgSlug}/settings/invites`}
            className="text-sm text-muted-foreground hover:underline mt-2 inline-block"
          >
            {tApprovals("backToSettings")}
          </Link>
        </div>
      )}

      {totalCount > PAGE_SIZE && (
        <div className="mt-8 pt-4 flex items-center justify-between">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {Math.ceil(totalCount / PAGE_SIZE)}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * PAGE_SIZE >= totalCount}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
