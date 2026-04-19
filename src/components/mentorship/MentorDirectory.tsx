"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Avatar, Button, EmptyState, Select, Input } from "@/components/ui";
import { MentorDetailModal, type MentorDetailData } from "./MentorDetailModal";
import { MentorRequestDialog } from "./MentorRequestDialog";
import {
  applyFilters,
  emptyFilters,
  excludeSelf,
  hasActiveFilters as filtersActive,
  hasPendingRequest,
  type DirectoryFilters,
} from "@/lib/mentorship/directory-helpers";

interface MentorData {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  photo_url: string | null;
  industry: string | null;
  graduation_year: number | null;
  current_company: string | null;
  current_city: string | null;
  expertise_areas: string[] | null;
  topics: string[] | null;
  sports: string[] | null;
  positions: string[] | null;
  bio: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  contact_phone: string | null;
  accepting_new: boolean;
  current_mentee_count: number;
  max_mentees: number;
  meeting_preferences: string[] | null;
  years_of_experience: number | null;
}

type Signal = { code: string; weight: number; value?: string | number };

interface MentorDirectoryProps {
  mentors: MentorData[];
  industries: string[];
  years: number[];
  sportOptions: string[];
  positionOptions: string[];
  orgHasAthleticData: boolean;
  pendingRequestMentorIds: string[];
  orgId: string;
  orgSlug: string;
  currentUserId: string;
  canRequestIntro: boolean;
  isAdmin: boolean;
}

type SortMode = "relevance" | "name" | "year";

export function MentorDirectory({
  mentors,
  industries,
  years,
  sportOptions,
  positionOptions,
  orgHasAthleticData,
  pendingRequestMentorIds,
  orgId,
  orgSlug,
  currentUserId,
  canRequestIntro,
  isAdmin,
}: MentorDirectoryProps) {
  const router = useRouter();
  const tMentorship = useTranslations("mentorship");
  const tMembers = useTranslations("members");
  const tCommon = useTranslations("common");

  const [filters, setFilters] = useState<DirectoryFilters>(emptyFilters);
  const [sortMode, setSortMode] = useState<SortMode>(
    canRequestIntro ? "relevance" : "name"
  );
  const [relevanceOrder, setRelevanceOrder] = useState<string[] | null>(null);
  const [mentorSignals, setMentorSignals] = useState<Record<string, Signal[]>>({});
  const [loadingRelevance, setLoadingRelevance] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>(pendingRequestMentorIds);

  const [detailMentor, setDetailMentor] = useState<MentorDetailData | null>(null);
  const [requestMentor, setRequestMentor] = useState<MentorDetailData | null>(null);

  const selfExcluded = useMemo(
    () => excludeSelf(mentors, currentUserId),
    [mentors, currentUserId]
  );

  const allTopics = useMemo(() => {
    const s = new Set<string>();
    selfExcluded.forEach((m) => m.topics?.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [selfExcluded]);

  useEffect(() => {
    setPendingIds(pendingRequestMentorIds);
  }, [pendingRequestMentorIds]);

  useEffect(() => {
    if (sortMode !== "relevance" || !canRequestIntro) return;
    let cancelled = false;
    const run = async () => {
      setLoadingRelevance(true);
      try {
        const res = await fetch(
          `/api/organizations/${orgId}/mentorship/suggestions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mentee_user_id: currentUserId, limit: 100 }),
          }
        );
        if (!res.ok) {
          if (!cancelled) {
            setRelevanceOrder([]);
            setMentorSignals({});
          }
          return;
        }
        const json = (await res.json()) as {
          matches: Array<{ mentorUserId: string; signals?: Signal[] }>;
        };
        if (cancelled) return;
        setRelevanceOrder(json.matches.map((m) => m.mentorUserId));
        const sigMap: Record<string, Signal[]> = {};
        for (const m of json.matches) {
          if (m.signals && m.signals.length > 0) sigMap[m.mentorUserId] = m.signals;
        }
        setMentorSignals(sigMap);
      } catch {
        if (!cancelled) {
          setRelevanceOrder([]);
          setMentorSignals({});
        }
      } finally {
        if (!cancelled) setLoadingRelevance(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [sortMode, canRequestIntro, orgId, currentUserId]);

  const filteredMentors = applyFilters(selfExcluded, filters);

  const sortedMentors = useMemo(() => {
    const copy = [...filteredMentors];
    if (sortMode === "name") {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === "year") {
      copy.sort((a, b) => (b.graduation_year ?? 0) - (a.graduation_year ?? 0));
    } else if (sortMode === "relevance") {
      if (relevanceOrder && relevanceOrder.length > 0) {
        const rank = new Map(relevanceOrder.map((id, idx) => [id, idx]));
        copy.sort((a, b) => {
          const ai = rank.get(a.user_id);
          const bi = rank.get(b.user_id);
          if (ai === undefined && bi === undefined) return a.name.localeCompare(b.name);
          if (ai === undefined) return 1;
          if (bi === undefined) return -1;
          return ai - bi;
        });
      } else {
        copy.sort((a, b) => a.name.localeCompare(b.name));
      }
    }
    return copy;
  }, [filteredMentors, sortMode, relevanceOrder]);

  const hasActiveFilters = filtersActive(filters);
  const clearFilters = () => setFilters(emptyFilters());

  const industryOptions = [
    { value: "", label: tMentorship("allIndustries") },
    ...industries.map((i) => ({ value: i, label: i })),
  ];

  const yearOptions = [
    { value: "", label: tMentorship("allYears") },
    ...years.map((y) => ({ value: y.toString(), label: tMembers("classOf", { year: y }) })),
  ];

  const sortOptions: Array<{ value: SortMode; label: string }> = [
    ...(canRequestIntro
      ? [{ value: "relevance" as SortMode, label: safeT(tMentorship, "sortRelevance", "Relevance") }]
      : []),
    { value: "name", label: safeT(tMentorship, "sortName", "Name") },
    { value: "year", label: safeT(tMentorship, "sortYear", "Graduation year") },
  ];

  const toDetailData = (m: MentorData): MentorDetailData => ({
    id: m.id,
    user_id: m.user_id,
    name: m.name,
    photo_url: m.photo_url,
    bio: m.bio,
    industry: m.industry,
    graduation_year: m.graduation_year,
    current_company: m.current_company,
    current_city: m.current_city,
    topics: m.topics,
    expertise_areas: m.expertise_areas,
    years_of_experience: m.years_of_experience,
    meeting_preferences: m.meeting_preferences,
    current_mentee_count: m.current_mentee_count,
    max_mentees: m.max_mentees,
    accepting_new: m.accepting_new,
    signals: mentorSignals[m.user_id] ?? [],
  });

  return (
    <div id="mentor-directory" className="space-y-6">
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          {tMentorship("willingToHelp")}
        </h2>
        <p className="text-[var(--muted-foreground)] text-sm mt-2 mb-4">
          {tMentorship("directoryDesc")}
        </p>

        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-4">
          <div className="w-full sm:flex-1">
            <Input
              type="search"
              value={filters.nameSearch}
              onChange={(e) => setFilters({ ...filters, nameSearch: e.target.value })}
              placeholder={tMentorship("searchPlaceholder")}
              aria-label={tMentorship("searchPlaceholder")}
            />
          </div>
          <div className="w-full sm:w-44">
            <Select
              label={safeT(tMentorship, "sortBy", "Sort by")}
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              options={sortOptions}
            />
          </div>
          <div className="w-full sm:w-48">
            <Select
              label={tMentorship("industry")}
              value={filters.industry}
              onChange={(e) => setFilters({ ...filters, industry: e.target.value })}
              options={industryOptions}
            />
          </div>
          <div className="w-full sm:w-40">
            <Select
              label={tMentorship("graduationYear")}
              value={filters.year}
              onChange={(e) => setFilters({ ...filters, year: e.target.value })}
              options={yearOptions}
            />
          </div>
        </div>

        {orgHasAthleticData && (
          <div className="flex flex-col gap-2 mb-4">
            {sportOptions.length > 0 && (
              <div className="flex flex-wrap gap-1" data-testid="sport-filter-chips">
                <span className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] mr-1 self-center">
                  {safeT(tMentorship, "sport", "Sport")}
                </span>
                <ChipButton
                  active={filters.sport === ""}
                  onClick={() => setFilters({ ...filters, sport: "" })}
                  label={safeT(tMentorship, "allSports", "All")}
                />
                {sportOptions.map((s) => (
                  <ChipButton
                    key={s}
                    active={filters.sport === s}
                    onClick={() =>
                      setFilters({ ...filters, sport: filters.sport === s ? "" : s })
                    }
                    label={s}
                  />
                ))}
              </div>
            )}
            {positionOptions.length > 0 && (
              <div className="flex flex-wrap gap-1" data-testid="position-filter-chips">
                <span className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] mr-1 self-center">
                  {safeT(tMentorship, "position", "Position")}
                </span>
                <ChipButton
                  active={filters.position === ""}
                  onClick={() => setFilters({ ...filters, position: "" })}
                  label={safeT(tMentorship, "allPositions", "All")}
                />
                {positionOptions.map((p) => (
                  <ChipButton
                    key={p}
                    active={filters.position === p}
                    onClick={() =>
                      setFilters({ ...filters, position: filters.position === p ? "" : p })
                    }
                    label={p}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-6">
          <label className="inline-flex items-center gap-2 text-sm text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={filters.acceptingOnly}
              onChange={(e) => setFilters({ ...filters, acceptingOnly: e.target.checked })}
            />
            {safeT(tMentorship, "acceptingNewOnly", "Accepting new mentees only")}
          </label>
          {allTopics.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <ChipButton
                active={filters.topic === ""}
                onClick={() => setFilters({ ...filters, topic: "" })}
                label={safeT(tMentorship, "allTopics", "All topics")}
              />
              {allTopics.map((topic) => (
                <ChipButton
                  key={topic}
                  active={filters.topic === topic}
                  onClick={() =>
                    setFilters({ ...filters, topic: filters.topic === topic ? "" : topic })
                  }
                  label={topic}
                />
              ))}
            </div>
          )}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-muted-foreground hover:text-foreground shrink-0 ml-auto"
            >
              {tMentorship("clearFilters")}
            </Button>
          )}
        </div>

        {loadingRelevance && (
          <p className="text-sm text-[var(--muted-foreground)] mb-3">
            {safeT(tMentorship, "loadingSignals", "Computing relevance…")}
          </p>
        )}

        <p className="text-xs text-muted-foreground mb-3">
          {tMentorship("resultsCount", { count: sortedMentors.length, total: selfExcluded.length })}
        </p>

        {sortedMentors.length === 0 ? (
          <EmptyState
            title={
              hasActiveFilters
                ? tMentorship("noMentorsFound")
                : isAdmin
                ? tMentorship("noMentorsAdminTitle")
                : tMentorship("noMentorsYet")
            }
            description={
              hasActiveFilters
                ? tMentorship("adjustFilters")
                : isAdmin
                ? tMentorship("noMentorsAdminDesc")
                : tMentorship("checkBackLater")
            }
            action={
              hasActiveFilters ? (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  {tMentorship("clearFilters")}
                </Button>
              ) : isAdmin ? (
                <Button onClick={() => router.push(`/${orgSlug}/members`)}>
                  {tMentorship("inviteAlumni")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div>
            {sortedMentors.map((mentor) => {
              const hasContactLinks = Boolean(
                mentor.contact_email || mentor.contact_linkedin || mentor.contact_phone
              );
              const atCapacity =
                !mentor.accepting_new || mentor.current_mentee_count >= mentor.max_mentees;
              const topicsAndAreas = [
                ...(mentor.topics ?? []),
                ...(mentor.expertise_areas ?? []),
              ];
              const isRequested = hasPendingRequest(pendingIds, mentor.user_id);

              return (
                <div
                  key={mentor.id}
                  data-testid={`mentor-card-${mentor.user_id}`}
                  className="group flex items-start gap-4 py-4 px-2 rounded-md hover:bg-[var(--muted)]/30 transition-colors duration-150"
                >
                  <button
                    type="button"
                    onClick={() => setDetailMentor(toDetailData(mentor))}
                    className="shrink-0"
                    aria-label={mentor.name}
                  >
                    <Avatar src={mentor.photo_url} name={mentor.name} size="md" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDetailMentor(toDetailData(mentor))}
                        className="text-sm font-medium text-[var(--foreground)] truncate hover:underline text-left"
                      >
                        {mentor.name}
                      </button>
                      {mentor.graduation_year && (
                        <span className="text-[11px] text-[var(--muted-foreground)]">
                          &apos;{mentor.graduation_year.toString().slice(-2)}
                        </span>
                      )}
                      {!mentor.accepting_new && (
                        <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] border border-[var(--border)] rounded px-1.5">
                          {safeT(tMentorship, "notAcceptingShort", "Not accepting")}
                        </span>
                      )}
                      {isRequested && (
                        <span
                          data-testid={`mentor-card-${mentor.user_id}-requested-badge`}
                          className="text-[10px] uppercase tracking-wider text-[var(--foreground)] bg-[var(--muted)]/60 rounded px-1.5"
                        >
                          {safeT(tMentorship, "requestSent", "Request sent")}
                        </span>
                      )}
                    </div>
                    {(mentor.current_company || mentor.current_city) && (
                      <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                        {[mentor.current_company, mentor.current_city]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    {topicsAndAreas.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {topicsAndAreas.map((area, idx) => (
                          <span
                            key={`${area}-${idx}`}
                            className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium bg-[var(--muted)]/40 text-[var(--muted-foreground)]"
                          >
                            {area}
                          </span>
                        ))}
                      </div>
                    )}
                    {mentor.bio && (
                      <p className="text-sm text-[var(--foreground)]/80 line-clamp-2 mt-1">{mentor.bio}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 mt-2">
                      {canRequestIntro && (
                        <Button
                          size="sm"
                          data-testid={`mentor-card-${mentor.user_id}-request`}
                          onClick={() => setRequestMentor(toDetailData(mentor))}
                          disabled={atCapacity || isRequested}
                        >
                          {isRequested
                            ? safeT(tMentorship, "requestSent", "Request sent")
                            : tMentorship("requestIntro")}
                        </Button>
                      )}
                      {hasContactLinks && (
                        <div className="flex flex-wrap gap-3 sm:opacity-0 sm:group-hover:opacity-100 sm:transition-opacity sm:duration-150">
                          {mentor.contact_email && (
                            <a
                              href={`mailto:${mentor.contact_email}`}
                              className="text-xs text-[var(--foreground)] hover:underline"
                            >
                              {tCommon("email")}
                            </a>
                          )}
                          {mentor.contact_linkedin && (
                            <a
                              href={
                                mentor.contact_linkedin.startsWith("http")
                                  ? mentor.contact_linkedin
                                  : `https://${mentor.contact_linkedin}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-[var(--foreground)] hover:underline"
                            >
                              {tMentorship("linkedin")}
                            </a>
                          )}
                          {mentor.contact_phone && (
                            <a
                              href={`tel:${mentor.contact_phone}`}
                              className="text-xs text-[var(--foreground)] hover:underline"
                            >
                              {tMentorship("phone")}
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <MentorDetailModal
        mentor={detailMentor}
        isOpen={detailMentor !== null}
        canRequestIntro={canRequestIntro}
        isRequestPending={detailMentor ? hasPendingRequest(pendingIds, detailMentor.user_id) : false}
        onClose={() => setDetailMentor(null)}
        onRequestIntro={(m) => {
          setDetailMentor(null);
          if (canRequestIntro) setRequestMentor(m);
        }}
      />

      <MentorRequestDialog
        mentor={requestMentor}
        orgId={orgId}
        currentUserId={currentUserId}
        isOpen={requestMentor !== null}
        onClose={() => setRequestMentor(null)}
        onSuccess={(mentorUserId) => {
          setRequestMentor(null);
          if (mentorUserId && !pendingIds.includes(mentorUserId)) {
            setPendingIds([...pendingIds, mentorUserId]);
          }
        }}
      />
    </div>
  );
}

function ChipButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] rounded-md px-2 py-0.5 border ${
        active
          ? "bg-[var(--foreground)] text-[var(--background)] border-transparent"
          : "border-[var(--border)] text-[var(--muted-foreground)]"
      }`}
    >
      {label}
    </button>
  );
}

function safeT(
  t: (key: string) => string,
  key: string,
  fallback: string
): string {
  try {
    const v = t(key);
    return v || fallback;
  } catch {
    return fallback;
  }
}
