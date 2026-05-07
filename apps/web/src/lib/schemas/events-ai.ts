import { safeString } from "@/lib/security/validation";
import {
  dateStringSchema,
  eventTypeSchema,
  optionalDateStringSchema,
  optionalSafeString,
  optionalTimeStringSchema,
  timeStringSchema,
} from "./common";
import { z } from "zod";

export const assistantEventDraftSchema = z.object({
  title: safeString(200).optional(),
  description: optionalSafeString(5000),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end_date: z
    .string()
    .refine((val) => val === "" || /^\d{4}-\d{2}-\d{2}$/.test(val), {
      message: "Must be a valid date (YYYY-MM-DD)",
    })
    .optional(),
  end_time: z
    .string()
    .refine((val) => val === "" || /^\d{2}:\d{2}$/.test(val), {
      message: "Must be a valid time (HH:MM)",
    })
    .optional(),
  location: optionalSafeString(500),
  event_type: eventTypeSchema.optional(),
  is_philanthropy: z.boolean().optional(),
});

export type AssistantEventDraft = z.infer<typeof assistantEventDraftSchema>;

export const assistantPreparedEventSchema = z
  .object({
    title: safeString(200),
    description: optionalSafeString(5000),
    start_date: dateStringSchema,
    start_time: timeStringSchema,
    end_date: optionalDateStringSchema,
    end_time: optionalTimeStringSchema,
    location: optionalSafeString(500),
    event_type: eventTypeSchema,
    is_philanthropy: z.boolean(),
  })
  .refine(
    (data) => {
      if (data.end_date && data.end_time) {
        const start = new Date(`${data.start_date}T${data.start_time}`);
        const end = new Date(`${data.end_date}T${data.end_time}`);
        return end > start;
      }

      return true;
    },
    {
      message: "End date/time must be after start date/time",
      path: ["end_date"],
    },
  );

export type AssistantPreparedEvent = z.infer<typeof assistantPreparedEventSchema>;
