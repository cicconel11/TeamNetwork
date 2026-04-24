import { z } from "zod";
import { safeToolQuery, truncateBody } from "@/lib/ai/tools/shared";
import type { ToolModule } from "./types";

const listAnnouncementsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    pinned_only: z.boolean().optional(),
  })
  .strict();

type Args = z.infer<typeof listAnnouncementsSchema>;

export const listAnnouncementsModule: ToolModule<Args> = {
  name: "list_announcements",
  argsSchema: listAnnouncementsSchema,
  async execute(args, { ctx, sb, logContext }) {
    const limit = Math.min(args.limit ?? 10, 25);
    const pinnedOnly = args.pinned_only ?? false;
    return safeToolQuery(logContext, async () => {
      let query = sb
        .from("announcements")
        .select("id, title, body, audience, is_pinned, published_at, created_at")
        .eq("organization_id", ctx.orgId)
        .is("deleted_at", null)
        .order("is_pinned", { ascending: false })
        .order("published_at", { ascending: false })
        .limit(limit);

      if (pinnedOnly) {
        query = query.eq("is_pinned", true);
      }

      const { data, error } = await query;

      if (!Array.isArray(data) || error) {
        return { data, error };
      }

      return {
        data: data.map((announcement) => ({
          id: announcement.id,
          title: announcement.title,
          audience: announcement.audience,
          is_pinned: Boolean(announcement.is_pinned),
          published_at: announcement.published_at ?? announcement.created_at ?? null,
          body_preview: truncateBody(announcement.body),
        })),
        error: null,
      };
    });
  },
};
