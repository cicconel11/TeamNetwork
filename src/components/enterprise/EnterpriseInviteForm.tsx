"use client";

import { useState } from "react";
import { Button, Card, Input, Select } from "@/components/ui";

interface Organization {
  id: string;
  name: string;
  slug: string;
}

interface EnterpriseInviteFormProps {
  enterpriseId: string;
  organizations: Organization[];
  onInviteCreated: () => void;
  onCancel: () => void;
}

export function EnterpriseInviteForm({
  enterpriseId,
  organizations,
  onInviteCreated,
  onCancel,
}: EnterpriseInviteFormProps) {
  const [selectedOrg, setSelectedOrg] = useState<string>("");
  const [role, setRole] = useState<"active_member" | "admin" | "alumni">("active_member");
  const [maxUses, setMaxUses] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedOrg) {
      setError("Please select an organization");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        organizationId: selectedOrg,
        role,
      };

      if (maxUses) {
        body.usesRemaining = parseInt(maxUses);
      }

      if (expiresAt) {
        body.expiresAt = new Date(expiresAt).toISOString();
      }

      const res = await fetch(`/api/enterprise/${enterpriseId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create invite");
      }

      onInviteCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setIsCreating(false);
    }
  };

  const orgOptions = [
    { value: "", label: "Select an organization" },
    ...organizations.map((org) => ({ value: org.id, label: org.name })),
  ];

  const roleOptions = [
    { value: "active_member", label: "Active Member" },
    { value: "admin", label: "Admin" },
    { value: "alumni", label: "Alumni" },
  ];

  return (
    <Card className="p-6">
      <h3 className="font-semibold text-foreground mb-4">Create New Invite</h3>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Select
            label="Organization"
            value={selectedOrg}
            onChange={(e) => setSelectedOrg(e.target.value)}
            options={orgOptions}
            required
          />
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as "active_member" | "admin" | "alumni")}
            options={roleOptions}
          />
          <Input
            label="Max Uses"
            type="number"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="Unlimited"
            min={1}
          />
          <Input
            label="Expires On"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <Button type="submit" isLoading={isCreating}>
            Generate Invite Code
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
