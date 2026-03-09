"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card, Select } from "@/components/ui";

import type { SubscriptionInfo } from "@/types/subscription";

interface Membership {
  user_id: string;
  role: string;
  status: "active" | "revoked" | "pending";
  users?: { name: string | null; email: string | null };
}

interface MembershipPanelProps {
  orgId: string;
  quota: Pick<SubscriptionInfo, "alumniLimit" | "alumniCount" | "remaining"> | null;
  onAlumniRoleChanged: () => void;
}

export function MembershipPanel({ orgId, quota, onAlumniRoleChanged }: MembershipPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [roleChangeUserId, setRoleChangeUserId] = useState<string | null>(null);
  const [isChangingRole, setIsChangingRole] = useState(false);
  const [showAdminConfirm, setShowAdminConfirm] = useState(false);
  const [pendingAdminUserId, setPendingAdminUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch memberships
  useEffect(() => {
    const fetchMemberships = async () => {
      const { data: membershipRows } = await supabase
        .from("user_organization_roles")
        .select("user_id, role, status, users(name,email)")
        .eq("organization_id", orgId);

      const normalizedMemberships: Membership[] =
        membershipRows?.map((m) => {
          const user = Array.isArray(m.users) ? m.users[0] : m.users;
          return {
            user_id: m.user_id,
            role: m.role,
            status: m.status as "active" | "revoked" | "pending",
            users: {
              name: user?.name ?? null,
              email: user?.email ?? null,
            },
          };
        }) || [];

      setMemberships(normalizedMemberships);
    };

    fetchMemberships();
  }, [orgId, supabase]);

  const canChangeToAlumni = useCallback(() => {
    if (!quota) return true;
    if (quota.alumniLimit === null) return true;
    return quota.remaining !== null && quota.remaining > 0;
  }, [quota]);

  const updateAccess = async (userId: string, status: "active" | "revoked") => {
    const res = await fetch(`/api/organizations/${orgId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error || "Failed to update access");
    } else {
      setMemberships((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, status } : m))
      );
    }
  };

  const updateRole = async (userId: string, newRole: "admin" | "active_member" | "alumni" | "parent") => {
    const currentMember = memberships.find((m) => m.user_id === userId);
    if (currentMember?.role === newRole) return;

    if (newRole === "admin") {
      setPendingAdminUserId(userId);
      setShowAdminConfirm(true);
      return;
    }

    setIsChangingRole(true);
    setRoleChangeUserId(userId);
    setError(null);

    const res = await fetch(`/api/organizations/${orgId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error || "Failed to update role");
    } else {
      setMemberships((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, role: newRole } : m))
      );
      if (newRole === "alumni" || currentMember?.role === "alumni") {
        onAlumniRoleChanged();
      }
    }

    setIsChangingRole(false);
    setRoleChangeUserId(null);
  };

  const confirmAdminPromotion = async () => {
    if (!pendingAdminUserId) return;

    setIsChangingRole(true);
    setRoleChangeUserId(pendingAdminUserId);
    setError(null);

    const res = await fetch(`/api/organizations/${orgId}/members/${pendingAdminUserId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error || "Failed to update role");
    } else {
      setMemberships((prev) =>
        prev.map((m) => (m.user_id === pendingAdminUserId ? { ...m, role: "admin" } : m))
      );
    }

    setIsChangingRole(false);
    setRoleChangeUserId(null);
    setShowAdminConfirm(false);
    setPendingAdminUserId(null);
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "admin": return "warning";
      case "alumni": return "muted";
      case "parent": return "primary";
      default: return "primary";
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case "admin": return "Admin";
      case "alumni": return "Alumni";
      case "parent": return "Parent";
      case "active_member": return "Active Member";
      case "member": return "Member";
      default: return role;
    }
  };

  return (
    <>
      <Card className="p-6 mt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-foreground">Access control</h3>
            <p className="text-sm text-muted-foreground">
              Manage roles and access for members of this org.
            </p>
            {quota && (
              <p className="text-xs text-muted-foreground mt-1">
                Alumni slots: {quota.alumniLimit === null
                  ? "Unlimited"
                  : `${quota.remaining ?? 0} remaining (${quota.alumniCount}/${quota.alumniLimit} used)`}
              </p>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {memberships.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members found.</p>
        ) : (
          <div className="divide-y divide-border">
            {memberships.map((m) => (
              <div key={m.user_id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {m.users?.name || m.users?.email || "User"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{m.users?.email}</p>
                </div>

                {m.status === "active" ? (
                  <div className="w-36">
                    <Select
                      value={m.role === "member" ? "active_member" : m.role}
                      onChange={(e) =>
                        updateRole(m.user_id, e.target.value as "admin" | "active_member" | "alumni" | "parent")
                      }
                      disabled={isChangingRole && roleChangeUserId === m.user_id}
                      options={[
                        { value: "active_member", label: "Active Member" },
                        { value: "alumni", label: "Alumni", disabled: m.role !== "alumni" && !canChangeToAlumni() },
                        { value: "parent", label: "Parent" },
                        { value: "admin", label: "Admin" },
                      ]}
                    />
                  </div>
                ) : (
                  <Badge variant={getRoleBadgeVariant(m.role)}>
                    {getRoleLabel(m.role)}
                  </Badge>
                )}

                <div className="flex items-center gap-2">
                  <Badge variant={m.status === "active" ? "success" : "error"}>
                    {m.status}
                  </Badge>

                  {isChangingRole && roleChangeUserId === m.user_id && (
                    <svg className="animate-spin h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}

                  {m.status === "active" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => updateAccess(m.user_id, "revoked")}
                      className="text-red-600 hover:text-red-700"
                      disabled={isChangingRole && roleChangeUserId === m.user_id}
                    >
                      Remove access
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => updateAccess(m.user_id, "active")}
                    >
                      Restore access
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Admin Promotion Confirmation Modal */}
      {showAdminConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="max-w-md w-full p-6 space-y-4">
            <div>
              <h3 className="text-lg font-bold text-amber-700 dark:text-amber-300">
                Confirm Admin Promotion
              </h3>
              <p className="text-sm text-muted-foreground mt-2">
                You are about to promote{" "}
                <strong>
                  {memberships.find((m) => m.user_id === pendingAdminUserId)?.users?.name ||
                    memberships.find((m) => m.user_id === pendingAdminUserId)?.users?.email ||
                    "this user"}
                </strong>{" "}
                to Admin.
              </p>
              <p className="text-sm text-muted-foreground mt-2">Admins have full access to:</p>
              <ul className="text-sm text-muted-foreground mt-1 list-disc list-inside">
                <li>Organization settings and billing</li>
                <li>Member management and approvals</li>
                <li>All content creation and editing</li>
                <li>Navigation customization</li>
              </ul>
            </div>

            <div className="flex gap-3 justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowAdminConfirm(false);
                  setPendingAdminUserId(null);
                }}
                disabled={isChangingRole}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmAdminPromotion}
                isLoading={isChangingRole}
                className="!bg-amber-600 !text-white hover:!bg-amber-700 !border-amber-600"
              >
                Promote to Admin
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
