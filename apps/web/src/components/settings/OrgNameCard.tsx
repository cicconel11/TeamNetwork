"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, Input } from "@/components/ui";
import { validateOrgName } from "@/lib/validation/org-name";

interface OrgNameCardProps {
  orgId: string;
  orgName: string;
  isAdmin: boolean;
  onNameUpdated: (newName: string) => void;
}

export function OrgNameCard({ orgId, orgName, isAdmin, onNameUpdated }: OrgNameCardProps) {
  const tSettings = useTranslations("settings");
  const tCommon = useTranslations("common");
  const [editedOrgName, setEditedOrgName] = useState(orgName);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState<string | null>(null);

  const handleNameSave = async () => {
    if (!isAdmin) {
      setNameError(tSettings("orgName.adminOnly"));
      return;
    }

    const validation = validateOrgName(editedOrgName);
    if (!validation.valid) {
      setNameError(validation.error || tSettings("orgName.invalid"));
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
        throw new Error(data?.error || tSettings("orgName.unableToUpdate"));
      }

      const updatedName = data?.name || editedOrgName.trim();
      setEditedOrgName(updatedName);
      setNameSuccess(tSettings("orgName.saved"));
      onNameUpdated(updatedName);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : tSettings("orgName.unableToUpdate"));
    } finally {
      setNameSaving(false);
    }
  };

  return (
    <Card className="org-settings-card p-5 space-y-4 opacity-0 translate-y-2 lg:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">{tSettings("orgName.title")}</p>
          <p className="text-sm text-muted-foreground">
            {tSettings("orgName.description")}
          </p>
        </div>
        <Badge variant={isAdmin ? "muted" : "warning"}>{isAdmin ? tCommon("admin") : tCommon("viewOnly")}</Badge>
      </div>

      <div className="max-w-md space-y-4">
        {isAdmin ? (
          <Input
            label={tCommon("name")}
            type="text"
            value={editedOrgName}
            onChange={(e) => {
              setEditedOrgName(e.target.value);
              setNameSuccess(null);
              setNameError(null);
            }}
            placeholder={tSettings("orgName.placeholder")}
            maxLength={100}
          />
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{tCommon("name")}</p>
            <p className="text-foreground">{orgName}</p>
          </div>
        )}
      </div>

      {nameSuccess && <div className="text-sm text-green-600 dark:text-green-400">{nameSuccess}</div>}
      {nameError && <div className="text-sm text-red-600 dark:text-red-400">{nameError}</div>}
      {!isAdmin && (
        <div className="text-sm text-muted-foreground">
          {tSettings("orgName.adminOnly")}
        </div>
      )}

      {isAdmin && (
        <div className="flex justify-end pt-1">
          <Button
            onClick={handleNameSave}
            isLoading={nameSaving}
            disabled={editedOrgName.trim() === orgName}
          >
            {tSettings("orgName.saveName")}
          </Button>
        </div>
      )}
    </Card>
  );
}
