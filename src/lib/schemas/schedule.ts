import { z } from "zod";
import {
  safeString,
  optionalSafeString,
  occurrenceTypeSchema,
  timeStringSchema,
  dateStringSchema,
  optionalDateStringSchema,
  safeUrl,
} from "./common";

// Academic schedule form
export const newScheduleSchema = z
  .object({
    title: safeString(200),
    occurrence_type: occurrenceTypeSchema,
    start_time: timeStringSchema,
    end_time: timeStringSchema,
    start_date: dateStringSchema,
    end_date: optionalDateStringSchema,
    day_of_week: z.array(z.string().regex(/^[0-6]$/)),
    day_of_month: z.string(),
    notes: optionalSafeString(1000),
  })
  .refine(
    (data) => data.start_time < data.end_time,
    {
      message: "End time must be after start time",
      path: ["end_time"],
    }
  )
  .refine(
    (data) => {
      if (data.end_date && data.start_date > data.end_date) {
        return false;
      }
      return true;
    },
    {
      message: "End date must be on or after start date",
      path: ["end_date"],
    }
  )
  .refine(
    (data) => {
      if (data.occurrence_type === "weekly" && data.day_of_week.length === 0) {
        return false;
      }
      return true;
    },
    {
      message: "Select at least one day of the week",
      path: ["day_of_week"],
    }
  );
export type NewScheduleForm = z.infer<typeof newScheduleSchema>;

export const editScheduleSchema = newScheduleSchema;
export type EditScheduleForm = z.infer<typeof editScheduleSchema>;

// API schemas for external schedule import
export const schedulePreviewSchema = z
  .object({
    orgId: z.string().uuid({ message: "Invalid organization ID" }),
    url: safeUrl(2048),
  })
  .strict();
export type SchedulePreviewRequest = z.infer<typeof schedulePreviewSchema>;

export const scheduleConnectSchema = z
  .object({
    orgId: z.string().uuid({ message: "Invalid organization ID" }),
    url: safeUrl(2048),
    title: optionalSafeString(200),
  })
  .strict();
export type ScheduleConnectRequest = z.infer<typeof scheduleConnectSchema>;
