"use client";

import { useCallback, useEffect, useRef } from "react";
import { markTourCompleted } from "@/lib/onboarding/progress";

// ─── Tour step definitions ────────────────────────────────────────────────────

const TOUR_STEPS = [
  {
    element: '[data-tour="feed"]',
    popover: {
      title: "Feed",
      description:
        "Share updates, photos, and polls with your org. Start by posting your intro!",
      side: "right" as const,
    },
  },
  {
    element: '[data-tour="calendar"]',
    popover: {
      title: "Calendar & Events",
      description:
        "See upcoming events and RSVP. Never miss a practice, meeting, or social.",
      side: "right" as const,
    },
  },
  {
    element: '[data-tour="messages"]',
    popover: {
      title: "Messages",
      description:
        "Chat with teammates in channels or direct messages. Conversations happen here.",
      side: "right" as const,
    },
  },
  {
    element: '[data-tour="announcements"]',
    popover: {
      title: "Announcements",
      description:
        "Important org-wide updates from leadership. Check here for the latest news.",
      side: "right" as const,
    },
  },
  {
    element: '[data-tour="members"]',
    popover: {
      title: "Members Directory",
      description:
        "Find teammates, explore profiles, and connect with your community.",
      side: "right" as const,
    },
  },
] as const;

// ─── Props ────────────────────────────────────────────────────────────────────

interface GuidedTourProps {
  active: boolean;
  userId: string;
  orgId: string;
  onComplete: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GuidedTour({
  active,
  userId,
  orgId,
  onComplete,
}: GuidedTourProps) {
  const driverRef = useRef<ReturnType<
    typeof import("driver.js")["driver"]
  > | null>(null);

  const handleTourEnd = useCallback(
    async (opts: { completed: boolean }) => {
      // Only persist tour_completed_at when user actually reached the last step.
      // Abandonment (ESC / close mid-tour) should leave the flag unset so the
      // user can be re-prompted next time.
      if (opts.completed) {
        try {
          await markTourCompleted(userId, orgId);
        } catch (err) {
          console.error("Failed to persist tour completion:", err);
        }
      }
      onComplete();
    },
    [userId, orgId, onComplete]
  );

  const startTour = useCallback(async () => {
    // Lazy-load driver.js to avoid adding to initial bundle
    // driver.js CSS is imported globally in globals.css
    const { driver } = await import("driver.js");

    // Filter steps to only those whose target element exists in the DOM
    const availableSteps = TOUR_STEPS.filter(
      (step) => !!document.querySelector(step.element)
    );

    if (availableSteps.length === 0) {
      onComplete();
      return;
    }

    const d = driver({
      animate: true,
      showProgress: true,
      showButtons: ["next", "previous", "close"],
      nextBtnText: "Next →",
      prevBtnText: "← Back",
      doneBtnText: "Finish",
      steps: availableSteps.map((step) => ({
        element: step.element,
        popover: {
          ...step.popover,
          align: "start",
        },
      })),
      onDestroyStarted: () => {
        // Reached the last step before destroy? Then it's a Finish, not abandon.
        const activeIndex = d.getActiveIndex?.() ?? -1;
        const completed = activeIndex === availableSteps.length - 1;
        d.destroy();
        handleTourEnd({ completed });
      },
    });

    driverRef.current = d;
    d.drive();
  }, [onComplete, handleTourEnd]);

  useEffect(() => {
    if (active) {
      startTour();
    }

    return () => {
      // Teardown on unmount — driver.js is idempotent re: destroy().
      driverRef.current?.destroy();
      driverRef.current = null;
    };
  }, [active, startTour]);

  // Pure effect — no DOM output
  return null;
}
