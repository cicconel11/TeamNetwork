"use client";

import { useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { validateOrgName } from "@/lib/validation/org-name";

interface OrgNameCardProps {
  orgId: string;
  orgName: string;
  isAdmin: boolean;
  onNameUpdated: (newName: string) => void;
}

export function OrgNameCard({ orgId, orgName, isAdmin, onNameUpdated }: OrgNameCardProps) {
  const [editedOrgName, setEditedOrgName] = useState(orgName);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState<string | null>(null);

  const handleNameSave = async () => {
    if (!isAdmin) {
      setNameError("Only admins can change the organization name.");
      return;
    }

    const validation = validateOrgName(editedOrgName);
    if (!validation.valid) {
      setNameError(validation.error || "Invalid organization name");
      return;
    }

    setNameSaving(true);
    setNameError(null);
    setNameSuccess(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editedOrgName.trim() }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || "Unable to update organization name");
      }

      const updatedName = data?.name || editedOrgName.trim();
      setEditedOrgName(updatedName);
      setNameSuccess("Organization name updated successfully.");
      onNameUpdated(updatedName);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Unable to update organization name");
    } finally {
      setNameSaving(false);
    }
  };

  return (
    <Card className="org-settings-card p-5 space-y-4 opacity-0 translate-y-2 lg:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">Organization name</p>
          <p className="text-sm text-muted-foreground">
            Change your organization&apos;s display name.
          </p>
        </div>
        <Badge variant={isAdmin ? "muted" : "warning"}>{isAdmin ? "Admin" : "View only"}</Badge>
      </div>

      <div className="max-w-md space-y-4">
        {isAdmin ? (
          <Input
            label="Name"
            type="text"
            value={editedOrgName}
            onChange={(e) => {
              setEditedOrgName(e.target.value);
              setNameSuccess(null);
              setNameError(null);
            }}
            placeholder="Organization name"
            maxLength={100}
          />
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Name</p>
            <p className="text-foreground">{orgName}</p>
          </div>
        )}
      </div>

      {nameSuccess && <div className="text-sm text-green-600 dark:text-green-400">{nameSuccess}</div>}
      {nameError && <div className="text-sm text-red-600 dark:text-red-400">{nameError}</div>}
      {!isAdmin && (
        <div className="text-sm text-muted-foreground">
          Only admins can change the organization name.
        </div>
      )}

      {isAdmin && (
        <div className="flex justify-end pt-1">
          <Button
            onClick={handleNameSave}
            isLoading={nameSaving}
            disabled={editedOrgName.trim() === orgName}
          >
            Save name
          </Button>
        </div>
      )}
    </Card>
  );
}
