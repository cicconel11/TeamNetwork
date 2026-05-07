export type RouteEntityKind =
  | "member"
  | "discussion_thread"
  | "event"
  | "job_posting"
  | "announcement";

export interface RouteEntityRef {
  kind: RouteEntityKind;
  id: string;
}

export interface RouteEntityContext {
  kind: RouteEntityKind;
  id: string;
  label: string;
  displayName: string;
  currentPath?: string;
  metadata: Array<{ label: string; value: string }>;
  nextActions: string[];
}

const UUID_LIKE_SEGMENT = /^[A-Za-z0-9_-]+$/;

function cleanPath(pathname: string | undefined): string | null {
  if (!pathname) return null;
  const pathOnly = pathname.split(/[?#]/, 1)[0] ?? "";
  if (!pathOnly.startsWith("/") || pathOnly.startsWith("//")) return null;
  return pathOnly.replace(/\/+$/, "") || "/";
}

export function getCurrentPathFeatureSegment(pathname: string | undefined): string | null {
  const path = cleanPath(pathname);
  if (!path) return null;

  const enterpriseMatch = path.match(/^\/enterprise\/[^/]+\/([^/]+)/);
  if (enterpriseMatch) {
    return enterpriseMatch[1] ?? null;
  }

  return path.match(/^\/[^/]+\/([^/]+)/)?.[1] ?? null;
}

export function extractRouteEntity(pathname: string | undefined): RouteEntityRef | null {
  const path = cleanPath(pathname);
  if (!path || path.startsWith("/enterprise/")) {
    return null;
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length < 3) {
    return null;
  }

  const [, feature, second, third] = segments;
  const id = second;
  const nestedId = third;

  switch (feature) {
    case "members":
      return buildRef("member", id, segments.length === 3);
    case "messages":
      if (second === "threads") {
        return buildRef("discussion_thread", nestedId, segments.length === 4);
      }
      return null;
    case "discussions":
      return buildRef("discussion_thread", id, segments.length === 3);
    case "calendar":
      if (second === "events") {
        return buildRef("event", nestedId, segments.length === 4);
      }
      return null;
    case "events":
      return buildRef("event", id, segments.length === 3);
    case "jobs":
      return buildRef("job_posting", id, segments.length === 3);
    case "announcements":
      if (third === "edit") {
        return buildRef("announcement", id, segments.length === 4);
      }
      return null;
    default:
      return null;
  }
}

export function extractCurrentMemberRouteId(pathname: string | undefined): string | null {
  const ref = extractRouteEntity(pathname);
  return ref?.kind === "member" ? ref.id : null;
}

export function extractCurrentDiscussionThreadRouteId(pathname: string | undefined): string | null {
  const ref = extractRouteEntity(pathname);
  return ref?.kind === "discussion_thread" ? ref.id : null;
}

function buildRef(
  kind: RouteEntityKind,
  id: string | undefined,
  exactShape: boolean
): RouteEntityRef | null {
  if (!exactShape || !id || !UUID_LIKE_SEGMENT.test(id)) {
    return null;
  }

  if (id === "new" || id === "edit") {
    return null;
  }

  return { kind, id };
}
