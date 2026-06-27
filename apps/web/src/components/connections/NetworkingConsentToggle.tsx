"use client";

import { useEffect, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";

interface NetworkingConsentToggleProps {
  orgId: string;
  labelOn: string;
  labelOff: string;
  helperOn: string;
  helperOff: string;
  noProfileMessage: string;
  errorMessage: string;
}

type LoadState = "loading" | "ready" | "error";

/**
 * Self-set "Open to networking" consent control for the connections page.
 *
 * Reads current state on mount, then PATCHes optimistically with rollback on
 * failure. The write lands on the user (RLS) client server-side, so a user can
 * only ever flip their own flag — this component just drives that one switch.
 */
export function NetworkingConsentToggle({
  orgId,
  labelOn,
  labelOff,
  helperOn,
  helperOff,
  noProfileMessage,
  errorMessage,
}: NetworkingConsentToggleProps) {
  const [checked, setChecked] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const endpoint = `/api/organizations/${orgId}/connections/networking-consent`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(endpoint, { method: "GET" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { open_to_networking?: boolean };
        if (!cancelled) {
          setChecked(Boolean(data.open_to_networking));
          setLoadState("ready");
        }
      } catch {
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const handleChange = (next: boolean) => {
    const previous = checked;
    setChecked(next); // optimistic
    setNotice(null);
    startTransition(async () => {
      try {
        const res = await fetch(endpoint, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ open_to_networking: next }),
        });
        if (res.status === 409) {
          setChecked(previous);
          setNotice(noProfileMessage);
          return;
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
      } catch {
        setChecked(previous); // rollback
        setNotice(errorMessage);
      }
    });
  };

  const disabled = loadState !== "ready" || isPending;

  return (
    <div
      className={`flex items-start gap-4 rounded-xl border p-4 transition-colors duration-300 ${
        checked
          ? "border-org-secondary/40 bg-org-secondary/5"
          : "border-border/70 bg-card/60"
      }`}
    >
      <div
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-300 ${
          checked ? "bg-org-secondary/15 text-org-secondary" : "bg-muted text-muted-foreground"
        }`}
        aria-hidden="true"
      >
        <Sparkles className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">
            {checked ? labelOn : labelOff}
          </p>
          <ToggleSwitch
            checked={checked}
            onChange={handleChange}
            disabled={disabled}
            label={checked ? labelOn : labelOff}
          />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {loadState === "error" ? errorMessage : checked ? helperOn : helperOff}
        </p>
        {notice && (
          <p className="mt-2 text-xs font-medium text-org-secondary" role="status">
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}
