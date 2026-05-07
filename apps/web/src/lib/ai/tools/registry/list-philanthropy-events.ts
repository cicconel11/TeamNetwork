import { z } from "zod";
import { safeToolQuery } from "@/lib/ai/tools/shared";
import type { ToolModule } from "./types";

const listPhilanthropyEventsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    upcoming: z.boolean().optional(),
  })
  .strict();

type Args = z.infer<typeof listPhilanthropyEventsSchema>;

export const listPhilanthropyEventsModule: ToolModule<Args> = {
  name: "list_philanthropy_events",
  argsSchema: listPhilanthropyEventsSchema,
  async execute(args, { ctx, sb, logContext }) {
    const limit = Math.min(args.limit ?? 10, 25);
    const upcoming = args.upcoming ?? true;
    const now = new Date().toISOString();
    return safeToolQuery(logContext, () => {
      let query = sb
        .from("events")
        .select("id, title, start_date, end_date, location, description")
        .eq("organization_id", ctx.orgId)
        .is("deleted_at", null)
        .or("is_philanthropy.eq.true,event_type.eq.philanthropy")
        .order("start_date", { ascending: upcoming })
        .limit(limit);
      if (upcoming) {
        query = query.gte("start_date", now);
      } else {
        query = query.lt("start_date", now);
      }
      return query;
    });
  },
};
