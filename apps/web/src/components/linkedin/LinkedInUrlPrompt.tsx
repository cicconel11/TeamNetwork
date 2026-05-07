"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { linkedInProfileUrlSchema } from "@/lib/alumni/linkedin-url";
import { shouldShowLinkedInPrompt } from "@/lib/linkedin/prompt-logic";

interface LinkedInStatusResponse {
  linkedin_url: string | null;
  connection: { status: string } | null;
  integration: { oauthAvailable: boolean; reason: string | null };
}

const DISMISS_KEY = "linkedin-url-prompt-dismissed";

function isDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function setDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* noop */
  }
}

interface PromptState {
  isOpen: boolean;
  loading: boolean;
  saving: boolean;
  url: string;
  error: string | null;
}

export function LinkedInUrlPrompt() {
  const [state, setState] = useState<PromptState>({
    isOpen: false,
    loading: true,
    saving: false,
    url: "",
    error: null,
  });

  useEffect(() => {
    let mounted = true;

    async function checkStatus() {
      if (isDismissed()) {
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }

      try {
        const res = await fetch("/api/user/linkedin/status");
        if (!res.ok) {
          setState((prev) => ({ ...prev, loading: false }));
          return;
        }

        const data: LinkedInStatusResponse = await res.json();
        if (!mounted) return;

        setState((prev) => ({
          ...prev,
          loading: false,
          isOpen: shouldShowLinkedInPrompt(data.connection, data.linkedin_url, false),
        }));
      } catch {
        if (mounted) {
          setState((prev) => ({ ...prev, loading: false }));
        }
      }
    }

    checkStatus();

    return () => {
      mounted = false;
    };
  }, []);

  const handleSave = useCallback(async () => {
    if (state.saving) return;

    if (!state.url.trim()) {
      setState((prev) => ({
        ...prev,
        error: "Please enter your LinkedIn profile URL",
      }));
      return;
    }

    const result = linkedInProfileUrlSchema.safeParse(state.url);
    if (!result.success) {
      setState((prev) => ({
        ...prev,
        error: result.error.issues[0]?.message ?? "Must be a valid LinkedIn profile URL (linkedin.com/in/...)",
      }));
      return;
    }

    setState((prev) => ({ ...prev, saving: true, error: null }));

    try {
      const res = await fetch("/api/user/linkedin/url", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_url: result.data }),
      });

      if (!res.ok) {
        const body: { error?: string } | null = await res.json().catch(() => null);
        setState((prev) => ({
          ...prev,
          saving: false,
          error: body?.error || "Failed to save LinkedIn URL",
        }));
        return;
      }

      setState((prev) => ({ ...prev, saving: false, isOpen: false }));
    } catch {
      setState((prev) => ({
        ...prev,
        saving: false,
        error: "Network error. Please try again.",
      }));
    }
  }, [state.saving, state.url]);

  const handleSkip = useCallback(() => {
    setDismissed();
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  if (state.loading || !state.isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <Card className="w-full max-w-md p-6 space-y-4" role="dialog" aria-modal="true">
        <div className="flex items-center gap-3">
          <svg
            className="h-8 w-8 text-[#0A66C2] shrink-0"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
          </svg>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Add your LinkedIn profile
            </h2>
            <p className="text-sm text-muted-foreground">
              Your teammates can find you on LinkedIn
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Input
            type="url"
            placeholder="https://linkedin.com/in/yourname"
            value={state.url}
            onChange={(e) =>
              setState((prev) => ({ ...prev, url: e.target.value, error: null }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            disabled={state.saving}
          />
          {state.error && (
            <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={state.saving}
            onClick={handleSkip}
          >
            Skip
          </Button>
          <Button
            size="sm"
            disabled={state.saving}
            onClick={handleSave}
          >
            {state.saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
