"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";

interface AvailableOrg {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface EnterpriseOrgPickerProps {
  organizations: AvailableOrg[];
  role: string;
  isLoading: boolean;
  onSelect: (orgId: string) => void;
}

export function EnterpriseOrgPicker({
  organizations,
  role,
  isLoading,
  onSelect,
}: EnterpriseOrgPickerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (organizations.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-muted-foreground">
          No organizations available to join. You may already be a member of all organizations in this enterprise.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <h3 className="text-lg font-semibold text-foreground">Choose an Organization</h3>
        <p className="text-sm text-muted-foreground">
          Select which organization you would like to join as <span className="font-medium">{formatRole(role)}</span>.
        </p>
      </div>

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {organizations.map((org) => (
          <button
            key={org.id}
            type="button"
            onClick={() => setSelectedId(org.id)}
            className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200 ${
              selectedId === org.id
                ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                : "border-border hover:border-muted-foreground/30 bg-card"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-muted text-foreground font-bold text-sm flex-shrink-0">
                {org.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">{org.name}</p>
                {org.description && (
                  <p className="text-sm text-muted-foreground truncate">{org.description}</p>
                )}
              </div>
              {selectedId === org.id && (
                <CheckIcon className="h-5 w-5 text-purple-600 flex-shrink-0" />
              )}
            </div>
          </button>
        ))}
      </div>

      <Button
        className="w-full"
        disabled={!selectedId || isLoading}
        isLoading={isLoading}
        onClick={() => selectedId && onSelect(selectedId)}
      >
        Join Organization
      </Button>
    </div>
  );
}

function formatRole(role: string): string {
  switch (role) {
    case "active_member": return "Active Member";
    case "admin": return "Admin";
    case "alumni": return "Alumni";
    default: return role;
  }
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}
