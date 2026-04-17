"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Avatar, Button } from "@/components/ui";

export interface MentorDetailData {
  id: string;
  user_id: string;
  name: string;
  photo_url: string | null;
  bio: string | null;
  industry: string | null;
  graduation_year: number | null;
  current_company: string | null;
  current_city: string | null;
  topics: string[] | null;
  expertise_areas: string[] | null;
  years_of_experience: number | null;
  meeting_preferences: string[] | null;
  current_mentee_count: number;
  max_mentees: number;
  accepting_new: boolean;
}

interface MentorDetailModalProps {
  mentor: MentorDetailData | null;
  isOpen: boolean;
  onClose: () => void;
  onRequestIntro: (mentor: MentorDetailData) => void;
}

export function MentorDetailModal({
  mentor,
  isOpen,
  onClose,
  onRequestIntro,
}: MentorDetailModalProps) {
  const t = useTranslations("mentorship");

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !mentor) return null;

  const chips = [...(mentor.topics ?? []), ...(mentor.expertise_areas ?? [])];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--background)] rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <Avatar src={mentor.photo_url} name={mentor.name} size="lg" />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              {mentor.name}
            </h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              {[mentor.current_company, mentor.current_city]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {mentor.graduation_year && (
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                {t("classOf", { year: mentor.graduation_year })}
              </p>
            )}
          </div>
        </div>

        {mentor.bio && (
          <p className="text-sm text-[var(--foreground)]/80">{mentor.bio}</p>
        )}

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chips.map((c, i) => (
              <span
                key={`${c}-${i}`}
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium bg-[var(--muted)]/40 text-[var(--muted-foreground)]"
              >
                {c}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
              {t("capacity")}
            </p>
            <p>
              {mentor.current_mentee_count} / {mentor.max_mentees}
            </p>
          </div>
          {mentor.years_of_experience !== null && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
                {t("yearsExperience")}
              </p>
              <p>{mentor.years_of_experience}</p>
            </div>
          )}
          {mentor.meeting_preferences && mentor.meeting_preferences.length > 0 && (
            <div className="col-span-2">
              <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
                {t("meetingPreferences")}
              </p>
              <p>{mentor.meeting_preferences.join(", ")}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("close")}
          </Button>
          <Button
            size="sm"
            onClick={() => onRequestIntro(mentor)}
            disabled={!mentor.accepting_new || mentor.current_mentee_count >= mentor.max_mentees}
          >
            {t("requestIntro")}
          </Button>
        </div>
      </div>
    </div>
  );
}
