import { resolveActionLabel, resolveLabel } from "@/lib/navigation/label-resolver";
import { type NavConfig } from "@/lib/navigation/nav-items";
import { getVisibleOrgNavItems } from "@/lib/navigation/visible-items";
import type { OrgRole } from "@/lib/auth/role-utils";

export interface NavigationTarget {
  label: string;
  href: string;
  description: string;
  kind: "page" | "create";
}

export interface NavigationSearchResult {
  state: "resolved" | "not_found";
  query: string;
  matches: NavigationTarget[];
}

interface NavigationCatalogEntry {
  href: string;
  label: string;
  description: string;
  kind: "page" | "create";
  keywords: readonly string[];
}

const CREATE_ROUTE_BY_PAGE: Partial<Record<string, string>> = {
  "/members": "/members/new",
  "/alumni": "/alumni/new",
  "/parents": "/parents/new",
  "/events": "/events/new",
  "/announcements": "/announcements/new",
  "/jobs": "/jobs/new",
  "/forms": "/forms/admin/new",
  "/workouts": "/workouts/new",
  "/philanthropy": "/philanthropy/new",
};

const EXTRA_KEYWORDS_BY_PAGE: Partial<Record<string, readonly string[]>> = {
  "": ["home", "dashboard", "overview", "landing"],
  "/members": ["people", "roster", "directory"],
  "/messages": ["chat", "group chat", "message"],
  "/alumni": ["graduates", "former members"],
  "/parents": ["family", "guardians"],
  "/mentorship": ["mentor", "mentors", "mentee", "mentorships", "networking", "connections"],
  "/events": ["event", "events", "calendar", "schedule"],
  "/announcements": ["announcement", "announcements", "news", "updates", "bulletin"],
  "/philanthropy": ["fundraising", "campaign", "campaigns"],
  "/donations": ["donation", "donations", "giving", "gifts"],
  "/expenses": ["expense", "expenses", "spend", "budget"],
  "/records": ["record", "records", "stats", "results"],
  "/calendar": ["calendar sync", "my calendar"],
  "/jobs": ["job", "jobs", "career", "careers", "hiring"],
  "/forms": ["form", "forms", "survey", "surveys", "submission", "submissions"],
  "/media": ["media", "archive", "photos", "videos", "files"],
  "/customization": ["branding", "theme", "customize"],
  "/settings/invites": ["settings", "invite", "invites", "admin settings"],
  "/settings/navigation": ["navigation", "sidebar", "menu", "nav settings"],
};

const NAVIGATION_QUERY_STOPWORDS = new Set([
  "open",
  "go",
  "to",
  "take",
  "me",
  "navigate",
  "where",
  "can",
  "do",
  "i",
  "find",
  "link",
  "create",
  "new",
  "add",
  "post",
  "publish",
  "send",
  "page",
  "the",
]);

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9/]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildCatalog(input: {
  orgSlug: string;
  navConfig: NavConfig | null | undefined;
  role: OrgRole | null;
  hasAlumniAccess?: boolean;
  hasParentsAccess?: boolean;
}): NavigationCatalogEntry[] {
  const visibleItems = getVisibleOrgNavItems({
    role: input.role,
    hasAlumniAccess: input.hasAlumniAccess,
    hasParentsAccess: input.hasParentsAccess,
    navConfig: input.navConfig,
  });

  const pageEntries = visibleItems.map((item) => {
    const href = item.href || "";
    return {
      href: `/${input.orgSlug}${href}`,
      label: resolveLabel(href, input.navConfig),
      description: `Open the ${resolveLabel(href, input.navConfig).toLowerCase()} page.`,
      kind: "page" as const,
      keywords: [
        item.label,
        href.replace(/\//g, " "),
        ...(EXTRA_KEYWORDS_BY_PAGE[href] ?? []),
      ]
        .map(normalize)
        .filter(Boolean),
    };
  });

  const createEntries = visibleItems.flatMap((item) => {
    const createHref = CREATE_ROUTE_BY_PAGE[item.href];
    if (!createHref) {
      return [];
    }

    const singularLabel = resolveActionLabel(item.href, input.navConfig, "").trim();

    return [
      {
        href: `/${input.orgSlug}${createHref}`,
        label: resolveActionLabel(item.href, input.navConfig, "New"),
        description: `Open the create page for ${resolveLabel(item.href, input.navConfig).toLowerCase()}.`,
        kind: "create" as const,
        keywords: [
          resolveLabel(item.href, input.navConfig),
          singularLabel,
          resolveActionLabel(item.href, input.navConfig, "New"),
          `create ${resolveLabel(item.href, input.navConfig)}`,
          `create ${singularLabel}`,
          `new ${resolveLabel(item.href, input.navConfig)}`,
          `new ${singularLabel}`,
          `add ${resolveLabel(item.href, input.navConfig)}`,
          `add ${singularLabel}`,
        ]
          .map(normalize)
          .filter(Boolean),
      },
    ];
  });

  return [...pageEntries, ...createEntries];
}

function hasCreateIntent(query: string): boolean {
  return /\b(create|new|add|post|publish|send)\b/i.test(query);
}

function scoreTarget(query: string, target: NavigationCatalogEntry): number {
  const normalizedQuery = normalize(query);
  const tokens = tokenize(query);
  const normalizedLabel = normalize(target.label);
  const normalizedHref = normalize(target.href.replace(/\//g, " "));
  const normalizedDescription = normalize(target.description);
  const createIntent = hasCreateIntent(query);

  let score = 0;

  if (normalizedQuery === normalizedLabel) {
    score += 120;
  }

  if (normalizedQuery.includes(normalizedLabel)) {
    score += 80;
  }

  if (normalizedQuery.includes(normalizedHref)) {
    score += 60;
  }

  for (const keyword of target.keywords) {
    if (normalizedQuery === keyword) {
      score += 100;
      continue;
    }

    if (normalizedQuery.includes(keyword)) {
      score += 45;
    }
  }

  for (const token of tokens) {
    if (NAVIGATION_QUERY_STOPWORDS.has(token)) {
      continue;
    }

    if (normalizedLabel.includes(token)) {
      score += 20;
    }
    if (normalizedHref.includes(token)) {
      score += 12;
    }
    if (normalizedDescription.includes(token)) {
      score += 8;
    }
    if (target.keywords.some((keyword) => keyword.includes(token))) {
      score += 15;
    }
  }

  if (score > 0 && createIntent && target.kind === "create") {
    score += 40;
  }

  if (score > 0 && !createIntent && target.kind === "page") {
    score += 10;
  }

  return score;
}

export function searchNavigationTargets(input: {
  query: string;
  orgSlug: string;
  navConfig?: NavConfig | null;
  role: OrgRole | null;
  hasAlumniAccess?: boolean;
  hasParentsAccess?: boolean;
  limit?: number;
}): NavigationSearchResult {
  const query = input.query.trim();
  if (!query) {
    return { state: "not_found", query, matches: [] };
  }

  const catalog = buildCatalog({
    orgSlug: input.orgSlug,
    navConfig: input.navConfig,
    role: input.role,
    hasAlumniAccess: input.hasAlumniAccess,
    hasParentsAccess: input.hasParentsAccess,
  });
  const matches = catalog
    .map((target) => ({ target, score: scoreTarget(query, target) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.target.label.localeCompare(right.target.label);
    })
    .slice(0, Math.min(input.limit ?? 5, 10))
    .map(({ target }) => ({
      label: target.label,
      href: target.href,
      description: target.description,
      kind: target.kind,
    }));

  if (matches.length === 0) {
    return { state: "not_found", query, matches: [] };
  }

  return {
    state: "resolved",
    query,
    matches,
  };
}
