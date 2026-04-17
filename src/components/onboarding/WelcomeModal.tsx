"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui";
import { markWelcomeSeen } from "@/lib/onboarding/progress";

// ─── Props ────────────────────────────────────────────────────────────────────

interface WelcomeModalProps {
  open: boolean;
  userId: string;
  orgId: string;
  orgName: string;
  onTakeTour: () => void;
  onShowChecklist: () => void;
  onDismiss: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WelcomeModal({
  open,
  userId,
  orgId,
  orgName,
  onTakeTour,
  onShowChecklist,
  onDismiss,
}: WelcomeModalProps) {
  async function persistAndClose(action: () => void) {
    try {
      await markWelcomeSeen(userId, orgId);
    } catch (err) {
      console.error("Failed to mark welcome seen:", err);
    }
    action();
  }

  // Radix calls this whenever the dialog wants to close (ESC, outside click
  // if allowed, programmatic). We funnel all close paths through dismiss so
  // welcome_seen_at always persists — otherwise the modal reopens next reload.
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      persistAndClose(onDismiss);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-8 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          aria-describedby="welcome-modal-description"
        >
          {/* Illustration */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-[var(--color-org-secondary)]/10 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-[var(--color-org-secondary)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
                />
              </svg>
            </div>
          </div>

          {/* Heading */}
          <Dialog.Title className="text-xl font-bold text-center text-foreground mb-2">
            Welcome to {orgName}!
          </Dialog.Title>
          <Dialog.Description
            id="welcome-modal-description"
            className="text-sm text-muted-foreground text-center mb-8 leading-relaxed"
          >
            Let&apos;s help you get the most out of your membership. What would
            you like to do first?
          </Dialog.Description>

          {/* CTAs */}
          <div className="space-y-3">
            <Button
              variant="primary"
              className="w-full"
              onClick={() => persistAndClose(onTakeTour)}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z"
                />
              </svg>
              Take the guided tour
            </Button>

            <Button
              variant="secondary"
              className="w-full"
              onClick={() => persistAndClose(onShowChecklist)}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Show me the checklist
            </Button>

            <button
              onClick={() => persistAndClose(onDismiss)}
              className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2 rounded-xl hover:bg-muted"
            >
              I&apos;ll explore on my own
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
