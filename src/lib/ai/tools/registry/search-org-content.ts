import { z } from "zod";
import { safeToolQuery } from "@/lib/ai/tools/shared";
import { normalizeRepeatedTitle } from "@/lib/search/normalize-title";
import { sanitizeIlikeInput } from "@/lib/security/validation";
import type { ToolModule } from "./types";

const searchOrgContentSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .strict();

type Args = z.infer<typeof searchOrgContentSchema>;

interface SearchRpcRow {
  entity_type: string;
  entity_id: string;
  title: string | null;
  snippet: string | null;
  url_path: string | null;
  rank: number | null;
  metadata: Record<string, unknown> | null;
}

const PER_TYPE_CAP = 5;

function buildSearchVariants(query: string): string[] {
  const trimmed = query.trim();
  const stripped = trimmed
    .replace(
      /^(?:find|search|look\s+up|show|get|list)?\s*(?:posts?|content|announcements?|events?)?\s*(?:mentioning|about|for|on|regarding)?\s+/i,
      ""
    )
    .trim();

  return [...new Set([trimmed, stripped].filter((value) => value.length > 0))];
}

function buildIlikeOr(columns: string[], variants: string[]): string {
  return variants
    .flatMap((variant) => {
      const safe = sanitizeIlikeInput(variant);
      return columns.map((column) => `${column}.ilike.%${safe}%`);
    })
    .join(",");
}

interface DirectAnnouncementRow {
  id: string;
  title: string | null;
  body: string | null;
  created_at: string | null;
}

interface DirectEventRow {
  id: string;
  title: string | null;
  description: string | null;
  start_date: string | null;
}

export const searchOrgContentModule: ToolModule<Args> = {
  name: "search_org_content",
  argsSchema: searchOrgContentSchema,
  async execute(args, { ctx, sb, logContext }) {
    const limit = Math.min(args.limit ?? 10, 25);
    return safeToolQuery(logContext, async () => {
      const { data: orgRow, error: orgError } = await sb
        .from("organizations")
        .select("id, slug")
        .eq("id", ctx.orgId)
        .maybeSingle();

      if (orgError || !orgRow?.slug) {
        return { data: null, error: orgError ?? new Error("Organization not found") };
      }

      const { data, error } = await sb.rpc("search_org_content", {
        p_org_id: ctx.orgId,
        p_org_slug: orgRow.slug,
        p_query: args.query,
        p_limit: limit,
      });

      if (error) {
        return { data: null, error };
      }

      const rawRows = (Array.isArray(data) ? data : []) as SearchRpcRow[];
      const variants = buildSearchVariants(args.query);
      const [announcementFallback, eventFallback] = await Promise.all([
        sb
          .from("announcements")
          .select("id, title, body, created_at")
          .eq("organization_id", ctx.orgId)
          .is("deleted_at", null)
          .or(buildIlikeOr(["title", "body"], variants))
          .order("created_at", { ascending: false })
          .limit(limit),
        sb
          .from("events")
          .select("id, title, description, start_date")
          .eq("organization_id", ctx.orgId)
          .is("deleted_at", null)
          .or(buildIlikeOr(["title", "description", "location"], variants))
          .order("start_date", { ascending: false })
          .limit(limit),
      ]);

      const fallbackRows: SearchRpcRow[] = [
        ...(Array.isArray(announcementFallback.data)
          ? (announcementFallback.data as DirectAnnouncementRow[]).map((row) => ({
              entity_type: "announcement",
              entity_id: row.id,
              title: row.title,
              snippet: row.body,
              url_path: `/${orgRow.slug}/announcements`,
              rank: 0.5,
              metadata: { announcement_id: row.id },
            }))
          : []),
        ...(Array.isArray(eventFallback.data)
          ? (eventFallback.data as DirectEventRow[]).map((row) => ({
              entity_type: "event",
              entity_id: row.id,
              title: row.title,
              snippet: row.description,
              url_path: `/${orgRow.slug}/calendar/events/${row.id}`,
              rank: 0.5,
              metadata: {},
            }))
          : []),
      ];

      const PERSON_TYPES = new Set(["member", "alumni"]);
      const seenTitleByType = new Map<string, Set<string>>();
      const seenPersonKeys = new Set<string>();
      const seenIds = new Set<string>();
      const countByType = new Map<string, number>();
      const rows: Array<{
        entity_type: string;
        entity_id: string;
        title: string | null;
        snippet: string | null;
        url_path: string | null;
      }> = [];

      for (const row of [...rawRows, ...fallbackRows]) {
        const idKey = `${row.entity_type}:${row.entity_id}`;
        if (seenIds.has(idKey)) continue;
        const normalizedTitle = normalizeRepeatedTitle(row.title);
        const type = row.entity_type;
        const titleKey = normalizedTitle.trim().toLowerCase();
        if (titleKey) {
          let seen = seenTitleByType.get(type);
          if (!seen) {
            seen = new Set();
            seenTitleByType.set(type, seen);
          }
          if (seen.has(titleKey)) continue;
          seen.add(titleKey);
        }
        if (PERSON_TYPES.has(type) && titleKey) {
          const snippetKey = (row.snippet ?? "").trim().toLowerCase();
          const personKey = `${titleKey}|${snippetKey}`;
          if (seenPersonKeys.has(personKey)) continue;
          seenPersonKeys.add(personKey);
        }
        const count = countByType.get(type) ?? 0;
        if (count >= PER_TYPE_CAP) continue;
        countByType.set(type, count + 1);
        seenIds.add(idKey);
        rows.push({
          entity_type: type,
          entity_id: row.entity_id,
          title: normalizedTitle || row.title,
          snippet: row.snippet,
          url_path: row.url_path,
        });
      }

      return { data: rows, error: null };
    });
  },
};
