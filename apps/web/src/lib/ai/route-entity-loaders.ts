import type { RouteEntityContext, RouteEntityRef } from "./route-entity";

type QueryChain = {
  select(columns: string): QueryChain;
  eq(column: string, value: unknown): QueryChain;
  is?(column: string, value: unknown): QueryChain;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
};

export interface RouteEntitySupabase {
  from(table: string): QueryChain;
}

export async function loadRouteEntityContext(input: {
  supabase: RouteEntitySupabase;
  organizationId: string;
  currentPath?: string;
  routeEntity: RouteEntityRef | null;
}): Promise<RouteEntityContext | null> {
  const routeEntity = input.routeEntity;
  if (!routeEntity) {
    return null;
  }

  const loaderInput: LoaderInput = {
    ...input,
    routeEntity,
  };

  switch (routeEntity.kind) {
    case "member":
      return await loadMemberContext(loaderInput);
    case "discussion_thread":
      return await loadDiscussionThreadContext(loaderInput);
    case "event":
      return await loadEventContext(loaderInput);
    case "job_posting":
      return await loadJobPostingContext(loaderInput);
    case "announcement":
      return await loadAnnouncementContext(loaderInput);
  }
}

async function loadMemberContext(input: LoaderInput): Promise<RouteEntityContext | null> {
  const row = await loadSingle(input.supabase, "members", input.organizationId, input.routeEntity.id, [
    "id",
    "first_name",
    "last_name",
    "email",
    "role",
    "status",
    "graduation_year",
    "current_company",
    "current_city",
  ]);
  if (!row) return null;

  const firstName = stringValue(row.first_name);
  const lastName = stringValue(row.last_name);
  const email = stringValue(row.email);
  const name = [firstName, lastName].filter(Boolean).join(" ").trim() || email;
  if (!name) return null;

  return {
    kind: "member",
    id: input.routeEntity.id,
    label: "Member profile",
    displayName: name,
    currentPath: input.currentPath,
    metadata: compactMetadata([
      ["Role", row.role],
      ["Status", row.status],
      ["Graduation year", row.graduation_year],
      ["Company", row.current_company],
      ["City", row.current_city],
    ]),
    nextActions: [
      "Ask for connection or mentorship suggestions for this member.",
      "Ask me to draft a direct message to this member.",
      "Open the profile page to edit or manage the member manually.",
    ],
  };
}

async function loadDiscussionThreadContext(input: LoaderInput): Promise<RouteEntityContext | null> {
  const row = await loadSingle(input.supabase, "discussion_threads", input.organizationId, input.routeEntity.id, [
    "id",
    "title",
    "reply_count",
    "is_pinned",
    "is_locked",
    "last_activity_at",
    "created_at",
  ]);
  const title = stringValue(row?.title);
  if (!row || !title) return null;

  return {
    kind: "discussion_thread",
    id: input.routeEntity.id,
    label: "Discussion thread",
    displayName: title,
    currentPath: input.currentPath,
    metadata: compactMetadata([
      ["Replies", row.reply_count],
      ["Pinned", row.is_pinned],
      ["Locked", row.is_locked],
      ["Last activity", formatDateTime(row.last_activity_at)],
      ["Created", formatDateTime(row.created_at)],
    ]),
    nextActions: [
      "Ask me to summarize this discussion.",
      "Ask me to draft a reply to this thread.",
      "Open the thread page to moderate or manage it manually.",
    ],
  };
}

async function loadEventContext(input: LoaderInput): Promise<RouteEntityContext | null> {
  const row = await loadSingle(input.supabase, "events", input.organizationId, input.routeEntity.id, [
    "id",
    "title",
    "start_date",
    "end_date",
    "location",
    "event_type",
    "is_philanthropy",
  ]);
  const title = stringValue(row?.title);
  if (!row || !title) return null;

  return {
    kind: "event",
    id: input.routeEntity.id,
    label: "Event",
    displayName: title,
    currentPath: input.currentPath,
    metadata: compactMetadata([
      ["Starts", formatDateTime(row.start_date)],
      ["Ends", formatDateTime(row.end_date)],
      ["Location", row.location],
      ["Type", row.event_type],
      ["Philanthropy", row.is_philanthropy],
    ]),
    nextActions: [
      "Ask me to summarize this event.",
      "Ask me to draft a related announcement or message.",
      "Open the event page to edit, delete, or manage attendance manually.",
    ],
  };
}

async function loadJobPostingContext(input: LoaderInput): Promise<RouteEntityContext | null> {
  const row = await loadSingle(input.supabase, "job_postings", input.organizationId, input.routeEntity.id, [
    "id",
    "title",
    "company",
    "location",
    "location_type",
    "industry",
    "experience_level",
    "is_active",
    "expires_at",
  ]);
  const title = stringValue(row?.title);
  if (!row || !title || row.is_active === false) return null;

  return {
    kind: "job_posting",
    id: input.routeEntity.id,
    label: "Job posting",
    displayName: title,
    currentPath: input.currentPath,
    metadata: compactMetadata([
      ["Company", row.company],
      ["Location", row.location],
      ["Location type", row.location_type],
      ["Industry", row.industry],
      ["Experience", row.experience_level],
      ["Expires", formatDateTime(row.expires_at)],
    ]),
    nextActions: [
      "Ask me to summarize this job posting.",
      "Ask me to draft an announcement or group message about it.",
      "Open the job page to edit or close the posting manually.",
    ],
  };
}

async function loadAnnouncementContext(input: LoaderInput): Promise<RouteEntityContext | null> {
  const row = await loadSingle(input.supabase, "announcements", input.organizationId, input.routeEntity.id, [
    "id",
    "title",
    "audience",
    "is_pinned",
    "published_at",
    "updated_at",
  ]);
  const title = stringValue(row?.title);
  if (!row || !title) return null;

  return {
    kind: "announcement",
    id: input.routeEntity.id,
    label: "Announcement",
    displayName: title,
    currentPath: input.currentPath,
    metadata: compactMetadata([
      ["Audience", row.audience],
      ["Pinned", row.is_pinned],
      ["Published", formatDateTime(row.published_at)],
      ["Updated", formatDateTime(row.updated_at)],
    ]),
    nextActions: [
      "Ask me to summarize this announcement.",
      "Ask me to draft a follow-up announcement or message.",
      "Use this edit page to change or delete the announcement manually.",
    ],
  };
}

type LoaderInput = {
  supabase: RouteEntitySupabase;
  organizationId: string;
  currentPath?: string;
  routeEntity: RouteEntityRef;
};

async function loadSingle(
  supabase: RouteEntitySupabase,
  table: string,
  organizationId: string,
  id: string,
  columns: string[]
): Promise<Record<string, unknown> | null> {
  const baseQuery = supabase
    .from(table)
    .select(columns.join(", "))
    .eq("id", id)
    .eq("organization_id", organizationId);
  const query = typeof baseQuery.is === "function" ? baseQuery.is("deleted_at", null) : baseQuery;
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw error;
  }
  if (!data || typeof data !== "object") {
    return null;
  }

  return data as Record<string, unknown>;
}

function compactMetadata(rows: Array<[string, unknown]>): Array<{ label: string; value: string }> {
  return rows
    .map(([label, value]) => {
      const normalized = stringValue(value);
      return normalized ? { label, value: normalized } : null;
    })
    .filter((row): row is { label: string; value: string } => row != null)
    .slice(0, 6);
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  return null;
}

function formatDateTime(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString();
}
