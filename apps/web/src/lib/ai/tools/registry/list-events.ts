import { z } from "zod";
import {
  EVENT_OUTPUT_FIELDS,
  projectFields,
  safeToolQuery,
  truncateBody,
} from "@/lib/ai/tools/shared";
import type { ToolModule } from "./types";

const listEventsSchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    upcoming: z.boolean().optional(),
    fields: z.array(z.enum(EVENT_OUTPUT_FIELDS)).min(1).optional(),
  })
  .strict();

type Args = z.infer<typeof listEventsSchema>;

interface EventRow {
  id: string;
  title: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  description: string | null;
}

export const listEventsModule: ToolModule<Args> = {
  name: "list_events",
  argsSchema: listEventsSchema,
  async execute(args, { ctx, sb, logContext }) {
    const limit = Math.min(args.limit ?? 10, 25);
    const upcoming = args.upcoming ?? true;
    const now = new Date().toISOString();
    // Default to the full event shape — events are not a heavy tool, so the win
    // here is body truncation, not narrowing. `fields` lets the model trim
    // further when it only needs e.g. titles + dates.
    const selectedFields = args.fields ?? EVENT_OUTPUT_FIELDS;
    return safeToolQuery(logContext, async () => {
      let query = sb
        .from("events")
        .select("id, title, start_date, end_date, location, description")
        .eq("organization_id", ctx.orgId)
        .is("deleted_at", null)
        .order("start_date", { ascending: upcoming })
        .limit(limit);
      if (upcoming) {
        query = query.gte("start_date", now);
      } else {
        query = query.lt("start_date", now);
      }

      const { data, error } = await query;
      if (!Array.isArray(data) || error) {
        return { data, error };
      }

      return {
        data: (data as EventRow[]).map((event) =>
          projectFields(
            {
              id: event.id,
              title: event.title,
              start_date: event.start_date,
              end_date: event.end_date,
              location: event.location,
              description_preview: truncateBody(event.description),
            },
            selectedFields
          )
        ),
        error,
      };
    });
  },
};
