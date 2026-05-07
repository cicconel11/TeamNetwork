import { z } from "zod";
import { safeToolQuery, truncateBody } from "@/lib/ai/tools/shared";
import type { ToolModule } from "./types";

const listDiscussionsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
  })
  .strict();

type Args = z.infer<typeof listDiscussionsSchema>;

export const listDiscussionsModule: ToolModule<Args> = {
  name: "list_discussions",
  argsSchema: listDiscussionsSchema,
  async execute(args, { ctx, sb, logContext }) {
    const limit = Math.min(args.limit ?? 10, 25);
    return safeToolQuery(logContext, async () => {
      const { data, error } = await sb
        .from("discussion_threads")
        .select("id, title, body, author_id, reply_count, created_at")
        .eq("organization_id", ctx.orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!Array.isArray(data) || error) {
        return { data, error };
      }

      return {
        data: data.map((discussion) => ({
          id: discussion.id,
          title: discussion.title,
          author_id: discussion.author_id,
          reply_count: discussion.reply_count ?? 0,
          created_at: discussion.created_at ?? null,
          body_preview: truncateBody(discussion.body),
        })),
        error: null,
      };
    });
  },
};
