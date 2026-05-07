import { isLinkedInProfileUrl } from "@/lib/alumni/linkedin-url";

interface ManualLinkedInSyncStateInput {
  linkedInUrl: string;
  brightDataConfigured: boolean;
  resyncEnabled: boolean;
  resyncIsAdmin: boolean;
  resyncRemaining: number;
  resyncMaxPerMonth: number;
}

export interface ManualLinkedInSyncState {
  visible: boolean;
  disabled: boolean;
  helperText: string | null;
}

export function getManualLinkedInSyncState({
  linkedInUrl,
  brightDataConfigured,
  resyncEnabled,
  resyncIsAdmin,
  resyncRemaining,
  resyncMaxPerMonth,
}: ManualLinkedInSyncStateInput): ManualLinkedInSyncState {
  if (!isLinkedInProfileUrl(linkedInUrl)) {
    return {
      visible: false,
      disabled: true,
      helperText: null,
    };
  }

  if (!brightDataConfigured) {
    return {
      visible: true,
      disabled: true,
      helperText: "Bright Data sync is not configured in this environment.",
    };
  }

  if (!resyncEnabled && !resyncIsAdmin) {
    return {
      visible: true,
      disabled: true,
      helperText: "LinkedIn data re-sync is managed by your organization.",
    };
  }

  if (resyncRemaining <= 0) {
    return {
      visible: true,
      disabled: true,
      helperText: "Limit reached. Your LinkedIn sync quota resets next month.",
    };
  }

  return {
    visible: true,
    disabled: false,
    helperText: `${resyncRemaining} of ${resyncMaxPerMonth} syncs remaining`,
  };
}
