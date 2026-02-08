"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Card, Button, Input, Badge, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";

interface EnterpriseAdmin {
  user_id: string;
  role: string;
  user_name: string | null;
  user_email: string | null;
}

interface EnterpriseSettings {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  primary_color: string | null;
  billing_contact_email: string | null;
}

export function SettingsClient() {
  const params = useParams();
  const enterpriseSlug = params.enterpriseSlug as string;

  const [, setSettings] = useState<EnterpriseSettings | null>(null);
  const [admins, setAdmins] = useState<EnterpriseAdmin[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#6B21A8");
  const [billingContactEmail, setBillingContactEmail] = useState("");

  // Invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"billing_admin" | "org_admin">("org_admin");
  const [isInviting, setIsInviting] = useState(false);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/enterprise/${enterpriseSlug}/settings`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load settings");
      }

      setSettings(data.enterprise);
      setAdmins(data.admins || []);
      setUserRole(data.userRole);

      // Populate form
      setName(data.enterprise.name || "");
      setDescription(data.enterprise.description || "");
      setLogoUrl(data.enterprise.logo_url || "");
      setPrimaryColor(data.enterprise.primary_color || "#6B21A8");
      setBillingContactEmail(data.enterprise.billing_contact_email || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  }, [enterpriseSlug]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/enterprise/${enterpriseSlug}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          logo_url: logoUrl || null,
          primary_color: primaryColor || null,
          billing_contact_email: billingContactEmail || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save settings");
      }

      setSuccessMessage("Settings saved successfully");
      setSettings(data.enterprise);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleInviteAdmin = async () => {
    if (!inviteEmail.trim()) return;

    setIsInviting(true);
    setError(null);

    try {
      const response = await fetch(`/api/enterprise/${enterpriseSlug}/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to invite admin");
      }

      setSuccessMessage("Admin invited successfully");
      setInviteEmail("");
      loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite admin");
    } finally {
      setIsInviting(false);
    }
  };

  const handleRemoveAdmin = async (userId: string) => {
    if (!confirm("Are you sure you want to remove this admin?")) return;

    try {
      const response = await fetch(`/api/enterprise/${enterpriseSlug}/admins/${userId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to remove admin");
      }

      setAdmins((prev) => prev.filter((a) => a.user_id !== userId));
      setSuccessMessage("Admin removed successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove admin");
    }
  };

  const getRoleBadgeVariant = (role: string): "primary" | "success" | "warning" | "muted" => {
    switch (role) {
      case "owner":
        return "primary";
      case "billing_admin":
        return "success";
      case "org_admin":
        return "warning";
      default:
        return "muted";
    }
  };

  const getRoleLabel = (role: string): string => {
    switch (role) {
      case "owner":
        return "Owner";
      case "billing_admin":
        return "Billing Admin";
      case "org_admin":
        return "Org Admin";
      default:
        return role;
    }
  };

  if (isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Settings" description="Loading..." />
        <div className="animate-pulse space-y-4">
          <div className="h-64 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  const isOwner = userRole === "owner";

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Settings"
        description="Manage your enterprise settings and administrators"
        backHref={`/enterprise/${enterpriseSlug}`}
      />

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-sm">
          {successMessage}
        </div>
      )}

      {/* General Settings */}
      <Card className="p-6 mb-6">
        <h3 className="font-semibold text-foreground mb-4">General Settings</h3>

        <div className="space-y-4">
          <Input
            label="Enterprise Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Enterprise"
          />

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description of your enterprise..."
              rows={3}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <Input
            label="Logo URL"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://example.com/logo.png"
          />

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Brand Color
            </label>
            <div className="flex items-center gap-4">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-12 w-20 rounded-xl border border-border cursor-pointer"
              />
              <Input
                type="text"
                placeholder="#6B21A8"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="flex-1"
              />
            </div>
          </div>

          <Input
            label="Billing Contact Email"
            type="email"
            value={billingContactEmail}
            onChange={(e) => setBillingContactEmail(e.target.value)}
            placeholder="billing@example.com"
          />

          <div className="pt-4">
            <Button onClick={handleSave} isLoading={isSaving}>
              Save Changes
            </Button>
          </div>
        </div>
      </Card>

      {/* Administrators */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-foreground">Enterprise Administrators</h3>
            <p className="text-sm text-muted-foreground">
              People who can manage this enterprise
            </p>
          </div>
        </div>

        {/* Admin List */}
        {admins.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="h-12 w-12" />}
            title="No administrators"
            description="Invite administrators to help manage this enterprise"
          />
        ) : (
          <div className="divide-y divide-border mb-6">
            {admins.map((admin) => (
              <div key={admin.user_id} className="py-3 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {admin.user_name || admin.user_email || "User"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{admin.user_email}</p>
                </div>
                <Badge variant={getRoleBadgeVariant(admin.role)}>
                  {getRoleLabel(admin.role)}
                </Badge>
                {isOwner && admin.role !== "owner" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveAdmin(admin.user_id)}
                    className="text-red-500 hover:text-red-600"
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Invite Admin (Owner only) */}
        {isOwner && (
          <div className="border-t border-border pt-4">
            <h4 className="font-medium text-foreground mb-3">Invite Administrator</h4>
            <div className="flex gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <Input
                  placeholder="email@example.com"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "billing_admin" | "org_admin")}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="org_admin">Org Admin</option>
                <option value="billing_admin">Billing Admin</option>
              </select>
              <Button
                onClick={handleInviteAdmin}
                isLoading={isInviting}
                disabled={!inviteEmail.trim()}
              >
                Invite
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Org Admins can create sub-organizations. Billing Admins can manage billing.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
      />
    </svg>
  );
}
