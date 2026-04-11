"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Badge, Avatar, Button, EmptyState, Select, Input } from "@/components/ui";
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
        <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          {tMentorship("willingToHelp")}
        </h2>
        <div className="mt-3 mb-4 h-px bg-border" />
        <p className="text-muted-foreground text-sm mb-4">
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
              className="border-border/70"
            />
          </div>
          <div className="w-full sm:w-40">
            <Select
              label={tMentorship("graduationYear")}
              value={filters.year}
              onChange={(e) => setFilters({ ...filters, year: e.target.value })}
              options={yearOptions}
              className="border-border/70"
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
          <Card className="mb-6 bg-muted/30 border-dashed">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium mb-1">{tMentorship("wantToGiveBack")}</h3>
                <p className="text-sm text-muted-foreground">
                  {tMentorship("joinDirectory")}
                </p>
              </div>
              <Button onClick={() => setShowRegistrationForm(true)}>
                {tMentorship("becomeMentor")}
              </Button>
            </div>
          </Card>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMentors.map((mentor) => {
              const hasContactLinks = Boolean(
                mentor.contact_email || mentor.contact_linkedin || mentor.contact_phone
              );

              return (
                <Card
                  key={mentor.id}
                  padding="md"
                  className="group relative overflow-hidden min-h-[220px]"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <Avatar
                      src={mentor.photo_url}
                      name={mentor.name}
                      size="lg"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-display text-lg font-semibold text-foreground truncate">
                        {mentor.name}
                      </h3>
                      {mentor.graduation_year && (
                        <div className="mt-1">
                          <Badge variant="muted">
                            &apos;{mentor.graduation_year.toString().slice(-2)}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={hasContactLinks ? "space-y-3 sm:pb-14" : "space-y-3"}>
                    {(mentor.current_company || mentor.current_city) && (
                      <p className="text-sm text-muted-foreground">
                        {[mentor.current_company, mentor.current_city]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}

                    {mentor.expertise_areas && mentor.expertise_areas.length > 0 && (
                      <div>
                        <div className="flex flex-wrap gap-1">
                          {mentor.expertise_areas.map((area, idx) => {
                            return (
                              <Badge key={idx} variant="primary">
                                {area}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {mentor.bio && (
                      <p className="text-sm line-clamp-2">{mentor.bio}</p>
                    )}
                  </div>

                  {hasContactLinks && (
                    <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-3 sm:absolute sm:inset-x-0 sm:bottom-0 sm:mt-0 sm:translate-y-full sm:bg-[var(--card)] sm:px-4 sm:py-3 sm:transition-transform sm:duration-200 sm:group-hover:translate-y-0 sm:focus-within:translate-y-0">
                      {mentor.contact_email && (
                        <a
                          href={`mailto:${mentor.contact_email}`}
                          className="text-sm text-org-primary hover:underline flex items-center gap-1"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                            />
                          </svg>
                          {tCommon("email")}
                        </a>
                      )}
                      {mentor.contact_linkedin && (
                        <a
                          href={mentor.contact_linkedin.startsWith("http") ? mentor.contact_linkedin : `https://${mentor.contact_linkedin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-org-primary hover:underline flex items-center gap-1"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                          </svg>
                          {tMentorship("linkedin")}
                        </a>
                      )}
                      {mentor.contact_phone && (
                        <a
                          href={`tel:${mentor.contact_phone}`}
                          className="text-sm text-org-primary hover:underline flex items-center gap-1"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                            />
                          </svg>
                          {tMentorship("phone")}
                        </a>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
