"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Avatar, Button, EmptyState, Select, Input } from "@/components/ui";
import { MentorRegistration } from "./MentorRegistration";

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
  bio: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  contact_phone: string | null;
}

interface MentorDirectoryProps {
  mentors: MentorData[];
  industries: string[];
  years: number[];
  showRegistration: boolean;
  orgId: string;
  orgSlug: string;
}

export function MentorDirectory({
  mentors,
  industries,
  years,
  showRegistration,
  orgId,
  orgSlug,
}: MentorDirectoryProps) {
  const tMentorship = useTranslations("mentorship");
  const tMembers = useTranslations("members");
  const tCommon = useTranslations("common");

  const [filters, setFilters] = useState({
    nameSearch: "",
    industry: "",
    year: "",
  });

  const [showRegistrationForm, setShowRegistrationForm] = useState(false);

  const nameQuery = filters.nameSearch.trim().toLowerCase();

  // Filter mentors
  const filteredMentors = mentors.filter((mentor) => {
    if (nameQuery && !mentor.name.toLowerCase().includes(nameQuery)) {
      return false;
    }
    if (filters.industry && mentor.industry !== filters.industry) {
      return false;
    }
    if (filters.year && mentor.graduation_year?.toString() !== filters.year) {
      return false;
    }
    return true;
  });

  const hasActiveFilters =
    filters.nameSearch !== "" || filters.industry !== "" || filters.year !== "";

  const clearFilters = () => {
    setFilters({
      nameSearch: "",
      industry: "",
      year: "",
    });
  };

  const industryOptions = [
    { value: "", label: tMentorship("allIndustries") },
    ...industries.map((i) => ({ value: i, label: i })),
  ];

  const yearOptions = [
    { value: "", label: tMentorship("allYears") },
    ...years.map((y) => ({ value: y.toString(), label: tMembers("classOf", { year: y }) })),
  ];

  return (
    <div id="mentor-directory" className="space-y-6">
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          {tMentorship("willingToHelp")}
        </h2>
        <p className="text-[var(--muted-foreground)] text-sm mt-2 mb-4">
          {tMentorship("directoryDesc")}
        </p>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-6">
          <div className="w-full sm:flex-1">
            <Input
              type="search"
              value={filters.nameSearch}
              onChange={(e) =>
                setFilters({ ...filters, nameSearch: e.target.value })
              }
              placeholder={tMentorship("searchPlaceholder")}
              aria-label={tMentorship("searchPlaceholder")}
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
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <svg
                className="h-4 w-4 mr-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              {tMentorship("clearFilters")}
            </Button>
          )}
        </div>

        {/* Registration CTA */}
        {showRegistration && !showRegistrationForm && (
          <div className="py-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">{tMentorship("wantToGiveBack")}</h3>
                <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
                  {tMentorship("joinDirectory")}
                </p>
              </div>
              <Button onClick={() => setShowRegistrationForm(true)}>
                {tMentorship("becomeMentor")}
              </Button>
            </div>
          </div>
        )}

        {/* Registration Form */}
        {showRegistration && showRegistrationForm && (
          <div className="mb-6">
            <MentorRegistration
              orgId={orgId}
              orgSlug={orgSlug}
              onCancel={() => setShowRegistrationForm(false)}
            />
          </div>
        )}

        {/* Mentor Grid */}
        {filteredMentors.length === 0 ? (
          <EmptyState
            icon={
              <svg
                className="h-12 w-12"
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
            }
            title={hasActiveFilters ? tMentorship("noMentorsFound") : tMentorship("noMentorsYet")}
            description={
              hasActiveFilters
                ? tMentorship("adjustFilters")
                : showRegistration
                ? tMentorship("beFirstMentorDesc")
                : tMentorship("checkBackLater")
            }
            action={
              hasActiveFilters ? (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  {tMentorship("clearFilters")}
                </Button>
              ) : showRegistration && !showRegistrationForm ? (
                <Button onClick={() => setShowRegistrationForm(true)}>
                  {tMentorship("beFirstMentor")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div>
            {filteredMentors.map((mentor) => {
              const hasContactLinks = Boolean(
                mentor.contact_email || mentor.contact_linkedin || mentor.contact_phone
              );

              return (
                <div
                  key={mentor.id}
                  className="group flex items-start gap-4 py-4 px-2 rounded-md hover:bg-[var(--muted)]/30 transition-colors duration-150"
                >
                  <Avatar
                    src={mentor.photo_url}
                    name={mentor.name}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-[var(--foreground)] truncate">
                        {mentor.name}
                      </h3>
                      {mentor.graduation_year && (
                        <span className="text-[11px] text-[var(--muted-foreground)]">
                          &apos;{mentor.graduation_year.toString().slice(-2)}
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
                    {mentor.expertise_areas && mentor.expertise_areas.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {mentor.expertise_areas.map((area, idx) => (
                          <span
                            key={idx}
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

                    {/* Contact links — visible on mobile, hover-reveal on desktop */}
                    {hasContactLinks && (
                      <div className="flex flex-wrap gap-3 mt-2 sm:opacity-0 sm:group-hover:opacity-100 sm:transition-opacity sm:duration-150">
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
                            href={mentor.contact_linkedin.startsWith("http") ? mentor.contact_linkedin : `https://${mentor.contact_linkedin}`}
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
