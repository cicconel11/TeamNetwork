"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { NavItemRow } from "./NavItemRow";
import { NavPreviewPanel } from "./NavPreviewPanel";
import { OrgSyncStatus } from "./OrgSyncStatus";
import { ORG_NAV_ITEMS } from "@/lib/navigation/nav-items";
import type { OrgRole } from "@/lib/auth/role-utils";
import type { NavConfig, NavConfigEntry } from "@/lib/navigation/nav-items";

interface Organization {
  id: string;
  name: string;
  slug: string;
  enterprise_nav_synced_at: string | null;
}

interface EnterpriseNavEditorProps {
  enterpriseId: string;
  initialNavConfig: NavConfig;
  initialLockedItems: string[];
  organizations: Organization[];
  onSave: (navConfig: NavConfig, lockedItems: string[]) => Promise<void>;
  onSync: () => Promise<void>;
}

export function EnterpriseNavEditor({
  enterpriseId,
  initialNavConfig,
  initialLockedItems,
  organizations,
  onSave,
  onSync,
}: EnterpriseNavEditorProps) {
  const [navConfig, setNavConfig] = useState<NavConfig>(initialNavConfig);
  const [lockedItems, setLockedItems] = useState<Set<string>>(new Set(initialLockedItems));
  const [previewRole, setPreviewRole] = useState<OrgRole>("active_member");
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);

  const handleToggleHidden = (path: string, hidden: boolean) => {
    setNavConfig((prev) => ({
      ...prev,
      [path]: {
        ...prev[path],
        hidden,
      },
    }));
    setHasChanges(true);
  };

  const handleToggleHiddenForRole = (path: string, role: OrgRole, hidden: boolean) => {
    setNavConfig((prev) => {
      const currentConfig = prev[path] || {};
      const currentHiddenForRoles = currentConfig.hiddenForRoles || [];

      let newHiddenForRoles: OrgRole[];
      if (hidden) {
        newHiddenForRoles = [...currentHiddenForRoles, role];
      } else {
        newHiddenForRoles = currentHiddenForRoles.filter((r) => r !== role);
      }

      return {
        ...prev,
        [path]: {
          ...currentConfig,
          hiddenForRoles: newHiddenForRoles.length > 0 ? newHiddenForRoles : undefined,
        },
      };
    });
    setHasChanges(true);
  };

  const handleToggleLocked = (path: string, locked: boolean) => {
    setLockedItems((prev) => {
      const newSet = new Set(prev);
      if (locked) {
        newSet.add(path);
      } else {
        newSet.delete(path);
      }
      return newSet;
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(navConfig, Array.from(lockedItems));
      setHasChanges(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await onSync();
      setShowSyncConfirm(false);
    } finally {
      setIsSyncing(false);
    }
  };

  // Filter out non-configurable items (like Settings and Navigation)
  const configurableItems = ORG_NAV_ITEMS.filter((item) => item.configurable !== false);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Editor Panel - 2 columns */}
      <div className="lg:col-span-2 space-y-6">
        {/* Header with Actions */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Navigation Items</h2>
            <p className="text-sm text-muted-foreground">
              Configure which tabs are visible across all sub-organizations
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => setShowSyncConfirm(true)}
              disabled={isSyncing || hasChanges}
            >
              <SyncIcon className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
              Sync to Orgs
            </Button>
            <Button
              onClick={handleSave}
              isLoading={isSaving}
              disabled={!hasChanges}
            >
              Save Changes
            </Button>
          </div>
        </div>

        {hasChanges && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm">
            You have unsaved changes. Save before syncing to organizations.
          </div>
        )}

        {/* Nav Item List */}
        <div className="space-y-2">
          {configurableItems.map((item) => {
            const config = navConfig[item.href] || {};
            return (
              <NavItemRow
                key={item.href}
                path={item.href}
                label={item.label}
                icon={item.icon}
                defaultRoles={item.roles}
                isHidden={config.hidden || false}
                hiddenForRoles={config.hiddenForRoles || []}
                isLocked={lockedItems.has(item.href)}
                onToggleHidden={(hidden) => handleToggleHidden(item.href, hidden)}
                onToggleHiddenForRole={(role, hidden) => handleToggleHiddenForRole(item.href, role, hidden)}
                onToggleLocked={(locked) => handleToggleLocked(item.href, locked)}
              />
            );
          })}
        </div>

        {/* Legend */}
        <Card className="p-4">
          <h3 className="font-medium text-foreground mb-2">Legend</h3>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked readOnly className="rounded border-border" />
              <span>Visible - Item appears in sidebar</span>
            </div>
            <div className="flex items-center gap-2">
              <LockIcon className="h-4 w-4 text-purple-600" />
              <span>Locked - Sub-orgs cannot override this setting</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Preview Panel - 1 column */}
      <div className="space-y-6">
        <NavPreviewPanel
          navItems={configurableItems}
          navConfig={navConfig}
          selectedRole={previewRole}
          onRoleChange={setPreviewRole}
        />

        <OrgSyncStatus
          organizations={organizations}
          lastConfigUpdate={hasChanges ? new Date().toISOString() : undefined}
        />
      </div>

      {/* Sync Confirmation Modal */}
      {showSyncConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <Card className="w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Sync Navigation to Organizations
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              This will update navigation settings for all {organizations.length} organizations.
              Only locked items will be enforced; other settings can still be customized by org admins.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowSyncConfirm(false)}>
                Cancel
              </Button>
              <Button onClick={handleSync} isLoading={isSyncing}>
                Sync All Organizations
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function SyncIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
      />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
      />
    </svg>
  );
}
