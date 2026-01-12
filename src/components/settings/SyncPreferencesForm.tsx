"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui";

export interface SyncPreferences {
  sync_general: boolean;
  sync_game: boolean;
  sync_meeting: boolean;
  sync_social: boolean;
  sync_fundraiser: boolean;
  sync_philanthropy: boolean;
}

interface SyncPreferencesFormProps {
  organizationId: string;
  preferences: SyncPreferences;
  isLoading?: boolean;
  disabled?: boolean;
  onPreferenceChange: (preferences: SyncPreferences) => Promise<void>;
}

const EVENT_TYPE_LABELS: Record<keyof SyncPreferences, { label: string; description: string }> = {
  sync_general: {
    label: "General Events",
    description: "General organization events and activities",
  },
  sync_game: {
    label: "Games",
    description: "Sports games and competitions",
  },
  sync_meeting: {
    label: "Meetings",
    description: "Chapter meetings and gatherings",
  },
  sync_social: {
    label: "Social Events",
    description: "Social gatherings and parties",
  },
  sync_fundraiser: {
    label: "Fundraisers",
    description: "Fundraising events and campaigns",
  },
  sync_philanthropy: {
    label: "Philanthropy",
    description: "Community service and philanthropy events",
  },
};

/**
 * SyncPreferencesForm component
 * 
 * Allows users to configure which event types sync to their Google Calendar.
 * 
 * Requirements: 5.1, 5.2
 * - Displays sync preference options for each event type
 * - Allows users to enable or disable sync for each event type
 */
export function SyncPreferencesForm({
  organizationId,
  preferences,
  isLoading = false,
  disabled = false,
  onPreferenceChange,
}: SyncPreferencesFormProps) {
  const [localPreferences, setLocalPreferences] = useState<SyncPreferences>(preferences);
  const [savingKey, setSavingKey] = useState<keyof SyncPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync local state with props when preferences change externally
  useEffect(() => {
    setLocalPreferences(preferences);
  }, [preferences]);

  const handleToggle = async (key: keyof SyncPreferences) => {
    if (disabled || savingKey) return;

    const newValue = !localPreferences[key];
    const newPreferences = { ...localPreferences, [key]: newValue };

    // Optimistically update local state
    setLocalPreferences(newPreferences);
    setSavingKey(key);
    setError(null);

    try {
      await onPreferenceChange(newPreferences);
    } catch (err) {
      // Revert on error
      setLocalPreferences(localPreferences);
      setError(err instanceof Error ? err.message : "Failed to save preference");
    } finally {
      setSavingKey(null);
    }
  };

  if (isLoading) {
    return (
      <Card className="p-5">
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-muted rounded w-1/3"></div>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-4 w-4 bg-muted rounded"></div>
              <div className="h-4 bg-muted rounded w-1/4"></div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  const eventTypeKeys = Object.keys(EVENT_TYPE_LABELS) as (keyof SyncPreferences)[];

  return (
    <Card className="p-5 space-y-4">
      <div>
        <p className="font-medium text-foreground">Sync Preferences</p>
        <p className="text-sm text-muted-foreground">
          Choose which types of events sync to your Google Calendar.
        </p>
      </div>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      <div className="space-y-3">
        {eventTypeKeys.map((key) => {
          const { label, description } = EVENT_TYPE_LABELS[key];
          const isChecked = localPreferences[key];
          const isSaving = savingKey === key;

          return (
            <label
              key={key}
              htmlFor={`${organizationId}-${key}`}
              className={`flex items-start gap-3 cursor-pointer ${
                disabled || savingKey ? "opacity-60 cursor-not-allowed" : ""
              }`}
            >
              <div className="relative flex items-center justify-center pt-0.5">
                <input
                  id={`${organizationId}-${key}`}
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={isChecked}
                  onChange={() => handleToggle(key)}
                  disabled={disabled || !!savingKey}
                />
                {isSaving && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <svg
                      className="animate-spin h-4 w-4 text-org-secondary"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  </div>
                )}
              </div>
              <div>
                <span className="font-medium text-sm text-foreground">{label}</span>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
            </label>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Changes are saved automatically. Preference changes do not affect previously synced events.
      </p>
    </Card>
  );
}
