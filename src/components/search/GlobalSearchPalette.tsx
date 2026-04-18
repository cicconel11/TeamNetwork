"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Briefcase,
  CalendarDays,
  GraduationCap,
  Megaphone,
  MessageSquare,
  Search,
  Settings,
  User,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useGlobalSearch, type GlobalSearchMode } from "./GlobalSearchProvider";
import { trackBehavioralEvent } from "@/lib/analytics/events";
import { detectIntent } from "@/lib/search/intent-fallback";

type FastSearchRow = {
  entity_type: string;
  entity_id: string;
  title: string | null;
  snippet: string | null;
  url_path: string | null;
  rank: number | null;
  metadata: Record<string, unknown> | null;
};

type AiSearchRow = {
  id: string;
  sourceTable: string;
  sourceId: string;
  title: string;
  snippet: string;
  url: string;
  similarity: number;
  metadata: Record<string, unknown>;
};

function recentKey(orgSlug: string) {
  return `tn_search_recent_${orgSlug}`;
}

function readRecents(orgSlug: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(recentKey(orgSlug));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

function pushRecent(orgSlug: string, q: string) {
  const t = q.trim();
  if (t.length < 1) return;
  const prev = readRecents(orgSlug).filter((x) => x.toLowerCase() !== t.toLowerCase());
  const next = [t, ...prev].slice(0, 5);
  window.localStorage.setItem(recentKey(orgSlug), JSON.stringify(next));
}

function entityIcon(entityType: string) {
  switch (entityType) {
    case "member":
      return Users;
    case "alumni":
      return GraduationCap;
    case "announcement":
      return Megaphone;
    case "discussion_thread":
    case "discussion_threads":
      return MessageSquare;
    case "event":
    case "events":
      return CalendarDays;
    case "job_posting":
    case "job_postings":
      return Briefcase;
    default:
      return Search;
  }
}

function entityLabel(entityType: string) {
  switch (entityType) {
    case "member":
      return "Member";
    case "alumni":
      return "Alumni";
    case "announcement":
      return "Announcement";
    case "discussion_thread":
      return "Discussion";
    case "event":
      return "Event";
    case "job_posting":
      return "Job";
    default:
      return entityType;
  }
}

export function GlobalSearchPalette() {
  const { orgSlug, orgId, currentProfileHref, open, setOpen } = useGlobalSearch();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<GlobalSearchMode>("fast");
  const [loading, setLoading] = useState(false);
  const [fastResults, setFastResults] = useState<FastSearchRow[]>([]);
  const [aiResults, setAiResults] = useState<AiSearchRow[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (open) {
      setRecents(readRecents(orgSlug));
    } else {
      setQuery("");
      setFastResults([]);
      setAiResults([]);
    }
  }, [open, orgSlug]);

  const minQueryLength = mode === "ai" ? 3 : 2;

  useEffect(() => {
    const q = query.trim();
    if (!open) return;
    if (q.length < minQueryLength) {
      setFastResults([]);
      setAiResults([]);
      setLoading(false);
      return;
    }

    const t = window.setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      try {
        const url = new URL(`/api/search/${encodeURIComponent(orgSlug)}`, window.location.origin);
        url.searchParams.set("q", q);
        url.searchParams.set("mode", mode);
        url.searchParams.set("limit", "20");
        const res = await fetch(url.toString(), { signal: ac.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { mode: GlobalSearchMode; results: FastSearchRow[] | AiSearchRow[] };
        if (body.mode === "fast") {
          setFastResults(body.results as FastSearchRow[]);
          setAiResults([]);
        } else {
          setAiResults(body.results as AiSearchRow[]);
          setFastResults([]);
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setFastResults([]);
        setAiResults([]);
      } finally {
        setLoading(false);
      }
    }, 100);
    return () => window.clearTimeout(t);
  }, [query, mode, open, orgSlug, minQueryLength]);

  const groupedFast = useMemo(() => {
    const m = new Map<string, FastSearchRow[]>();
    const seenTitlesPerType = new Map<string, Set<string>>();
    for (const r of fastResults) {
      const k = r.entity_type;
      const titleKey = (r.title ?? "").trim().toLowerCase();
      if (titleKey) {
        if (!seenTitlesPerType.has(k)) seenTitlesPerType.set(k, new Set());
        const seen = seenTitlesPerType.get(k)!;
        if (seen.has(titleKey)) continue;
        seen.add(titleKey);
      }
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return [...m.entries()];
  }, [fastResults]);

  const groupedAi = useMemo(() => {
    const m = new Map<string, { row: AiSearchRow; pos: number }[]>();
    aiResults.forEach((row, idx) => {
      const k = row.sourceTable;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push({ row, pos: idx + 1 });
    });
    // Singular source-table aliases used by the AI mode (events, job_postings,
    // discussion_threads) → canonical intent key.
    const intentToSource: Record<string, string> = {
      job_posting: "job_postings",
      event: "events",
      discussion_thread: "discussion_threads",
    };
    const intent = detectIntent(query);
    const intentSource = intent ? (intentToSource[intent] ?? intent) : null;
    const entries = [...m.entries()];
    entries.sort(([aKey, aItems], [bKey, bItems]) => {
      if (intentSource) {
        if (aKey === intentSource && bKey !== intentSource) return -1;
        if (bKey === intentSource && aKey !== intentSource) return 1;
      }
      const aTop = aItems[0]?.row.similarity ?? 0;
      const bTop = bItems[0]?.row.similarity ?? 0;
      return bTop - aTop;
    });
    return entries;
  }, [aiResults, query]);

  const navigateTo = useCallback(
    (url: string, meta: { entityType: string; position: number; qLen: number }) => {
      pushRecent(orgSlug, query);
      trackBehavioralEvent(
        "search_result_click",
        {
          query_length: meta.qLen,
          mode,
          clicked_entity_type: meta.entityType,
          result_position: meta.position,
        },
        orgId,
      );
      setOpen(false);
      router.push(url);
    },
    [orgId, mode, orgSlug, query, router, setOpen],
  );

  const runAction = useCallback(
    (id: string, href: string) => {
      trackBehavioralEvent("search_action_click", { action: id }, orgId);
      setOpen(false);
      router.push(href);
    },
    [orgId, router, setOpen],
  );

  const actions = useMemo(() => {
    const items: { id: string; label: string; href: string; icon: LucideIcon }[] = [];
    if (currentProfileHref) {
      items.push({ id: "profile", label: "Profile", href: currentProfileHref, icon: User });
    }
    items.push({ id: "calendar", label: "Calendar", href: `/${orgSlug}/calendar`, icon: CalendarDays });
    items.push({ id: "settings", label: "Settings", href: `/${orgSlug}/settings/invites`, icon: Settings });
    return items;
  }, [currentProfileHref, orgSlug]);

  const announcementHint = mode === "ai" && /\bannouncement\b/i.test(query.trim());

  const dialogOverlay = isMobile
    ? "fixed inset-0 z-[60] bg-background/95 backdrop-blur-sm"
    : "fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm";

  const dialogContent = isMobile
    ? "fixed inset-0 z-[60] flex flex-col bg-background border-0 shadow-none p-0 overflow-hidden max-h-screen"
    : "fixed left-1/2 top-[15%] z-[60] w-full max-w-xl max-h-[min(80vh,640px)] -translate-x-1/2 rounded-xl border border-border bg-background shadow-lg overflow-hidden flex flex-col";

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={dialogContent}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
        >
          <Dialog.Title className="sr-only">Search organization</Dialog.Title>
          <Command
            label="Search organization"
            shouldFilter={false}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
              }
              if (e.key === "Tab") {
                e.preventDefault();
                setMode((m) => (m === "fast" ? "ai" : "fast"));
              }
            }}
            className="flex h-full min-h-0 flex-col"
          >
      <div className={`flex items-center gap-2 border-b border-border px-3 py-2 shrink-0 ${isMobile ? "pt-4" : ""}`}>
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search members, events, jobs…"
          className="flex-1 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          autoFocus
        />
        {isMobile && (
          <button
            type="button"
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
            aria-label="Close search"
            onClick={() => setOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <Command.List className="flex-1 min-h-0 overflow-y-auto p-2">
        {actions.length > 0 && (
          <Command.Group heading="Actions">
            {actions.map((a) => {
              const Icon = a.icon;
              return (
                <Command.Item
                  key={a.id}
                  value={`action:${a.id}`}
                  onSelect={() => runAction(a.id, a.href)}
                  className="flex cursor-pointer gap-3 rounded-lg px-2 py-2 text-left aria-selected:bg-muted aria-selected:text-org-secondary"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-1 text-sm font-medium text-foreground">{a.label}</div>
                  </div>
                </Command.Item>
              );
            })}
          </Command.Group>
        )}

        {query.trim().length === 0 && (
          <Command.Group heading="Recent">
            {recents.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                Type to search. Use <kbd className="rounded bg-muted px-1">⌘K</kbd> anytime.
              </div>
            ) : (
              recents.map((r) => (
                <Command.Item
                  key={r}
                  value={`recent:${r}`}
                  onSelect={() => setQuery(r)}
                  className="flex cursor-pointer items-center rounded-lg px-2 py-2 text-sm text-foreground aria-selected:bg-muted"
                >
                  {r}
                </Command.Item>
              ))
            )}
          </Command.Group>
        )}

        {query.trim().length > 0 && query.trim().length < minQueryLength && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {mode === "ai"
              ? "Type at least 3 characters for semantic search."
              : "Type at least 2 characters."}
          </div>
        )}

        {loading && query.trim().length >= minQueryLength && (
          <Command.Loading className="py-8 text-center text-sm text-muted-foreground">Searching…</Command.Loading>
        )}

        {!loading && query.trim().length >= minQueryLength && mode === "fast" && fastResults.length === 0 && (
          <Command.Empty className="py-8 text-center text-sm text-muted-foreground">No results.</Command.Empty>
        )}

        {!loading && query.trim().length >= minQueryLength && mode === "ai" && aiResults.length === 0 && (
          <Command.Empty className="py-8 text-center text-sm text-muted-foreground">No semantic matches.</Command.Empty>
        )}

        {mode === "fast" &&
          groupedFast.map(([type, rows]) => (
            <Command.Group key={type} heading={entityLabel(type)}>
              {rows.map((row) => {
                const Icon = entityIcon(row.entity_type);
                const url = row.url_path || `/${orgSlug}`;
                const pos = fastResults.indexOf(row) + 1;
                return (
                  <Command.Item
                    key={`${row.entity_type}:${row.entity_id}`}
                    value={`${row.entity_type}:${row.entity_id}`}
                    onSelect={() =>
                      navigateTo(url, {
                        entityType: row.entity_type,
                        position: pos,
                        qLen: query.trim().length,
                      })
                    }
                    className="flex cursor-pointer gap-3 rounded-lg px-2 py-2 text-left aria-selected:bg-muted aria-selected:text-org-secondary"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 text-sm font-medium text-foreground">
                        {row.title || "Untitled"}
                      </div>
                      {row.snippet ? (
                        <div className="line-clamp-2 text-xs text-muted-foreground">{row.snippet}</div>
                      ) : null}
                    </div>
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}

        {mode === "ai" &&
          groupedAi.map(([type, items]) => (
            <Command.Group key={type} heading={entityLabel(type)}>
              {items.map(({ row, pos }) => {
                const Icon = entityIcon(row.sourceTable);
                return (
                  <Command.Item
                    key={row.id}
                    value={row.id}
                    onSelect={() =>
                      navigateTo(row.url, {
                        entityType: row.sourceTable,
                        position: pos,
                        qLen: query.trim().length,
                      })
                    }
                    className="flex cursor-pointer gap-3 rounded-lg px-2 py-2 text-left aria-selected:bg-muted aria-selected:text-org-secondary"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 text-sm font-medium text-foreground">{row.title}</div>
                      {row.snippet ? (
                        <div className="line-clamp-2 text-xs text-muted-foreground">{row.snippet}</div>
                      ) : null}
                    </div>
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
      </Command.List>

      <div className="border-t border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex flex-col gap-1 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
            onClick={() => setMode((m) => (m === "fast" ? "ai" : "fast"))}
          >
            Mode: <span className="text-org-secondary">{mode === "fast" ? "Fast" : "AI"}</span>
            <span className="ml-2 text-muted-foreground">(Tab)</span>
          </button>
          {!isMobile && (
            <span>
              <kbd className="rounded bg-muted px-1">esc</kbd> close
            </span>
          )}
        </div>
        {announcementHint && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            Announcements are in fast search only — switch to Fast mode (Tab).
          </p>
        )}
      </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
