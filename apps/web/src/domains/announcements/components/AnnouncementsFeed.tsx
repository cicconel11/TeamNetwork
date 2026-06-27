"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Badge, Button, EmptyState } from "@/components/ui";
import { AnnouncementCard } from "./AnnouncementCard";
import { MegaphoneIcon } from "./icons";
import type { Database } from "@/types/database";

type Announcement = Database["public"]["Tables"]["announcements"]["Row"];

interface AnnouncementsFeedProps {
  announcements: Announcement[];
  orgSlug: string;
  isAdmin: boolean;
  pageLabel: string;
  actionLabel: string;
}

const PAGE_SIZE = 10;

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
      />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function filterAnnouncements(items: Announcement[], query: string): Announcement[] {
  if (!query.trim()) return items;
  const lower = query.toLowerCase();
  return items.filter(
    (a) =>
      a.title.toLowerCase().includes(lower) ||
      (a.body ?? "").toLowerCase().includes(lower)
  );
}

export function AnnouncementsFeed({
  announcements,
  orgSlug,
  isAdmin,
  pageLabel,
  actionLabel,
}: AnnouncementsFeedProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
      setVisibleCount(PAGE_SIZE);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Reset pagination when announcements prop changes (e.g., after delete + refresh)
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [announcements.length]);

  const filtered = filterAnnouncements(announcements, debouncedQuery);
  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  function handleLoadMore() {
    setVisibleCount((prev) => prev + PAGE_SIZE);
  }

  function handleClearSearch() {
    setQuery("");
    setDebouncedQuery("");
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{pageLabel}</h1>
          <Badge variant="muted">{filtered.length}</Badge>
        </div>
        {isAdmin && (
          <Link href={`/${orgSlug}/announcements/new`}>
            <Button>
              <PlusIcon className="h-4 w-4" />
              {actionLabel}
            </Button>
          </Link>
        )}
      </div>

      {/* Search bar — only shown when there are announcements */}
      {announcements.length > 0 && (
        <div className="relative mb-6">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <SearchIcon className="h-4 w-4 text-muted-foreground" />
          </div>
          <input
            type="search"
            className="input w-full"
            style={{ paddingLeft: "2.5rem" }}
            placeholder={`Search ${pageLabel.toLowerCase()}…`}
            aria-label={`Search ${pageLabel}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {/* Feed list */}
      {visible.length > 0 && (
        <div className="space-y-4 stagger-children">
          {visible.map((announcement) => (
            <AnnouncementCard
              key={announcement.id}
              announcement={announcement}
              orgSlug={orgSlug}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}

      {/* Load-more */}
      {hasMore && (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={handleLoadMore}>
            <ChevronDownIcon className="h-4 w-4" />
            Load More
          </Button>
        </div>
      )}

      {/* Search empty state */}
      {filtered.length === 0 && debouncedQuery && (
        <EmptyState
          icon={<SearchIcon className="h-12 w-12" />}
          title="No results found"
          description={`No ${pageLabel} match "${debouncedQuery}"`}
          action={
            <Button variant="secondary" onClick={handleClearSearch}>
              Clear search
            </Button>
          }
        />
      )}

      {/* No announcements empty state */}
      {announcements.length === 0 && (
        <EmptyState
          icon={<MegaphoneIcon className="h-12 w-12" />}
          title={`No ${pageLabel} yet`}
          description={`${pageLabel} from your organization will appear here`}
          action={
            isAdmin ? (
              <Link href={`/${orgSlug}/announcements/new`}>
                <Button>Create First</Button>
              </Link>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
