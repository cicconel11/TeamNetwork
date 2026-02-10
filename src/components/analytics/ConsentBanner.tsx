"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, Button } from "@/components/ui";
import { setAnalyticsContext } from "@/lib/analytics/client";
import type { AgeBracket } from "@/lib/analytics/types";

/**
 * Analytics consent toggle for the user settings page.
 * Allows users to opt in/out of anonymous usage pattern tracking.
 */
export function ConsentBanner() {
  const [consented, setConsented] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [ageBracket, setAgeBracket] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      setAgeBracket(user.user_metadata?.age_bracket ?? null);

      const response = await fetch("/api/analytics/consent");
      if (response.ok) {
        const data = await response.json();
        setConsented(data.consented ?? false);
      }
      setLoading(false);
    }

    load();
  }, [supabase]);

  const handleToggle = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/analytics/consent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consented: !consented }),
      });

      if (response.ok) {
        const newConsented = !consented;
        setConsented(newConsented);
        // Immediately update the client-side tracking level so the change
        // takes effect without requiring a page reload.
        setAnalyticsContext(
          newConsented,
          (ageBracket as AgeBracket) ?? null,
          null, // org type will be re-derived on next route change
        );
        // Notify other components (e.g. useUIProfile) of consent change
        window.dispatchEvent(
          new CustomEvent("analytics:consent-change", {
            detail: { consented: newConsented },
          }),
        );
        setMessage({ type: "success", text: newConsented ? "Usage analytics enabled" : "Usage analytics disabled" });
      } else {
        const err = await response.json();
        setMessage({ type: "error", text: err.error || "Failed to update preference" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-5 text-muted-foreground text-sm">
        Loading analytics preferences...
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-4">
      <div>
        <p className="font-medium text-foreground">Usage Analytics</p>
        <p className="text-sm text-muted-foreground mt-1">
          Help improve your experience by sharing anonymous usage patterns. We track which
          features you navigate to and how often — never the content you view.
        </p>
      </div>

      {ageBracket === "13_17" && (
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
          Because you are under 18, only basic page visit counts are collected. No timing data
          or behavioral patterns are tracked.
        </div>
      )}

      <label htmlFor="analytics-consent" className="flex items-center gap-3 cursor-pointer">
        <input
          id="analytics-consent"
          type="checkbox"
          className="h-4 w-4 rounded border-border"
          checked={consented}
          onChange={handleToggle}
          disabled={saving}
        />
        <div>
          <span className="font-medium text-sm text-foreground">
            Enable anonymous usage analytics
          </span>
          <p className="text-xs text-muted-foreground">
            You can change this at any time. Your data is never sold.
          </p>
        </div>
      </label>

      {message && (
        <div
          className={`text-sm ${
            message.type === "success"
              ? "text-green-600 dark:text-green-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      {saving && (
        <Button isLoading disabled size="sm">
          Saving...
        </Button>
      )}
    </Card>
  );
}
