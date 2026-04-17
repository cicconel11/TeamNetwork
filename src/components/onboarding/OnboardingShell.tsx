"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WelcomeModal } from "./WelcomeModal";
import { ChecklistCard } from "./ChecklistCard";
import { GuidedTour } from "./GuidedTour";
import { getVisibleOnboardingItems } from "@/lib/onboarding/visible-items";
import type { OrgRole } from "@/lib/auth/role-utils";
import type { OnboardingProgress } from "@/lib/onboarding/progress";

// ─── Props ────────────────────────────────────────────────────────────────────

interface OnboardingShellProps {
  userId: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  memberId?: string | null;
  role: OrgRole | null;
  hasAlumniAccess: boolean;
  hasParentsAccess?: boolean;
  initialProgress: OnboardingProgress;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OnboardingShell({
  userId,
  orgId,
  orgSlug,
  orgName,
  memberId,
  role,
  hasAlumniAccess,
  hasParentsAccess = false,
  initialProgress,
}: OnboardingShellProps) {
  const [welcomeOpen, setWelcomeOpen] = useState(
    !initialProgress.welcomeSeenAt
  );
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [tourActive, setTourActive] = useState(false);
  const [dismissed, setDismissed] = useState(
    !!initialProgress.dismissedAt
  );

  // Sync progress from /api/onboarding/status on mount (hydrates auto-completions)
  const [progress, setProgress] = useState<OnboardingProgress>(initialProgress);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;
    const params = new URLSearchParams({ orgId });
    if (memberId) params.set("memberId", memberId);

    fetch(`/api/onboarding/status?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.completedItems) {
          setProgress((prev) => ({
            ...prev,
            completedItems: data.completedItems,
            visitedItems: data.visitedItems ?? prev.visitedItems,
            welcomeSeenAt: data.welcomeSeenAt ?? prev.welcomeSeenAt,
            tourCompletedAt: data.tourCompletedAt ?? prev.tourCompletedAt,
            dismissedAt: data.dismissedAt ?? prev.dismissedAt,
          }));
          if (data.dismissedAt) setDismissed(true);
        }
      })
      .catch((err) => {
        if (!cancelled) console.error("Failed to fetch onboarding status:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, memberId]);

  // Listen for ChecklistTrigger's CustomEvent to reopen the panel
  useEffect(() => {
    function handleOpenEvent() {
      setChecklistOpen(true);
    }
    window.addEventListener("tn:open-onboarding", handleOpenEvent);
    return () => {
      window.removeEventListener("tn:open-onboarding", handleOpenEvent);
    };
  }, []);

  // Dispatch progress updates so ChecklistTrigger can reflect current state
  // via a shared event bus (count synced via window event)
  const visibleItems = getVisibleOnboardingItems({
    role,
    hasAlumniAccess,
    hasParentsAccess,
  });
  const completedCount = visibleItems.filter((item) =>
    progress.completedItems.includes(item.id)
  ).length;

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("tn:onboarding-progress", {
        detail: { completedCount, totalCount: visibleItems.length },
      })
    );
  }, [completedCount, visibleItems.length]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleWelcomeTakeTour = useCallback(() => {
    setWelcomeOpen(false);
    setTourActive(true);
  }, []);

  const handleWelcomeShowChecklist = useCallback(() => {
    setWelcomeOpen(false);
    setChecklistOpen(true);
  }, []);

  const handleWelcomeDismiss = useCallback(() => {
    setWelcomeOpen(false);
  }, []);

  const handleTourComplete = useCallback(() => {
    setTourActive(false);
    setChecklistOpen(true);
  }, []);

  const handleChecklistDismiss = useCallback(() => {
    setChecklistOpen(false);
    setDismissed(true);
    // Notify the sidebar trigger to hide itself (OrgSidebar listens for this).
    window.dispatchEvent(new CustomEvent("tn:onboarding-dismissed"));
  }, []);

  // Close the floating checklist panel when the user clicks through to an item.
  const handleChecklistClose = useCallback(() => {
    setChecklistOpen(false);
  }, []);

  // Don't render if dismissed and not reopened via trigger
  if (dismissed && !checklistOpen) return null;

  return (
    <>
      {/* Welcome modal — one-time on first org visit */}
      <WelcomeModal
        open={welcomeOpen}
        userId={userId}
        orgId={orgId}
        orgName={orgName}
        onTakeTour={handleWelcomeTakeTour}
        onShowChecklist={handleWelcomeShowChecklist}
        onDismiss={handleWelcomeDismiss}
      />

      {/* Checklist side panel */}
      {checklistOpen && (
        <div
          className="fixed bottom-6 right-6 z-[60] w-80 shadow-2xl rounded-2xl"
          role="complementary"
          aria-label="Getting started checklist"
        >
          <ChecklistCard
            userId={userId}
            orgId={orgId}
            orgSlug={orgSlug}
            memberId={memberId}
            role={role}
            hasAlumniAccess={hasAlumniAccess}
            hasParentsAccess={hasParentsAccess}
            initialProgress={progress}
            onDismiss={handleChecklistDismiss}
            onItemClick={handleChecklistClose}
          />
        </div>
      )}

      {/* Guided tour — effect-only, no DOM */}
      <GuidedTour
        active={tourActive}
        userId={userId}
        orgId={orgId}
        onComplete={handleTourComplete}
      />
    </>
  );
}
