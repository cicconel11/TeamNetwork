import { z } from "zod";
import {
  safeString,
  optionalSafeString,
  audienceSchema,
  announcementAudienceSchema,
  channelSchema,
  eventTypeSchema,
  dateStringSchema,
  optionalDateStringSchema,
  timeStringSchema,
  optionalTimeStringSchema,
  optionalHttpsUrlSchema,
  dayOfWeekSchema,
  dayOfMonthSchema,
} from "./common";

// Announcement form
export const newAnnouncementSchema = z.object({
  title: safeString(200),
  body: optionalSafeString(5000),
  is_pinned: z.boolean(),
  audience: announcementAudienceSchema,
  send_notification: z.boolean(),
});
export type NewAnnouncementForm = z.infer<typeof newAnnouncementSchema>;

// Edit announcement form - no send_notification (already sent)
export const editAnnouncementSchema = z.object({
  title: safeString(200),
  body: optionalSafeString(5000),
  is_pinned: z.boolean(),
  audience: announcementAudienceSchema,
});
export type EditAnnouncementForm = z.infer<typeof editAnnouncementSchema>;

// ─── Recurrence schemas ───────────────────────────────────────────────

export const recurrenceOccurrenceSchema = z.enum(["daily", "weekly", "monthly"]);
export type RecurrenceOccurrence = z.infer<typeof recurrenceOccurrenceSchema>;

export const recurrenceRuleSchema = z.discriminatedUnion("occurrence_type", [
  z.object({
    occurrence_type: z.literal("daily"),
    recurrence_end_date: optionalDateStringSchema,
  }),
  z.object({
    occurrence_type: z.literal("weekly"),
    day_of_week: dayOfWeekSchema,
    recurrence_end_date: optionalDateStringSchema,
  }),
  z.object({
    occurrence_type: z.literal("monthly"),
    day_of_month: dayOfMonthSchema,
    recurrence_end_date: optionalDateStringSchema,
  }),
]);
export type RecurrenceRuleForm = z.infer<typeof recurrenceRuleSchema>;

export const editScopeSchema = z.enum(["this_only", "this_and_future"]);
export type EditScope = z.infer<typeof editScopeSchema>;

export const deleteScopeSchema = z.enum(["this_only", "this_and_future", "all_in_series"]);
export type DeleteScope = z.infer<typeof deleteScopeSchema>;

// Event form
export const newEventSchema = z
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
    audience: audienceSchema,
    send_notification: z.boolean(),
    channel: channelSchema,
    is_recurring: z.boolean(),
    recurrence: recurrenceRuleSchema.optional(),
  })
  .refine(
    (data) => {
      // If end date is provided, validate date/time logic
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
    }
  )
  .refine(
    (data) => {
      // If recurring, recurrence rule is required
      if (data.is_recurring && !data.recurrence) return false;
      return true;
    },
    {
      message: "Recurrence settings are required for recurring events",
      path: ["recurrence"],
    }
  );
export type NewEventForm = z.infer<typeof newEventSchema>;

// Edit event form - no send_notification, audience, or channel (already sent)
export const editEventSchema = z
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
    }
  );
export type EditEventForm = z.infer<typeof editEventSchema>;

// Workout form
export const newWorkoutSchema = z.object({
  title: safeString(200),
  description: optionalSafeString(5000),
  workout_date: optionalDateStringSchema,
  external_url: optionalHttpsUrlSchema,
  audience: audienceSchema,
  send_notification: z.boolean(),
  channel: channelSchema,
});
export type NewWorkoutForm = z.infer<typeof newWorkoutSchema>;

// Edit workout form - no send_notification, audience, or channel (already sent)
export const editWorkoutSchema = z.object({
  title: safeString(200),
  description: optionalSafeString(5000),
  workout_date: optionalDateStringSchema,
  external_url: optionalHttpsUrlSchema,
});
export type EditWorkoutForm = z.infer<typeof editWorkoutSchema>;

// Record form - keep year as string for form handling
export const newRecordSchema = z.object({
  title: safeString(200),
  category: optionalSafeString(100),
  value: safeString(100),
  holder_name: safeString(200),
  year: z
    .string()
    .refine(
      (val) => {
        if (!val) return true; // Allow empty
        const num = parseInt(val, 10);
        return !isNaN(num) && num >= 1800 && num <= 2100;
      },
      { message: "Year must be between 1800 and 2100" }
    )
    .optional(),
  notes: optionalSafeString(1000),
});
export type NewRecordForm = z.infer<typeof newRecordSchema>;

// Expense form - keep amount as string for form handling
export const newExpenseSchema = z.object({
  name: safeString(200),
  expense_type: safeString(200),
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((val) => {
      const num = parseFloat(val);
      return !isNaN(num) && num > 0;
    }, { message: "Amount must be greater than 0" }),
  venmo_link: optionalSafeString(500),
});
export type NewExpenseForm = z.infer<typeof newExpenseSchema>;

export const editExpenseSchema = newExpenseSchema;
export type EditExpenseForm = z.infer<typeof editExpenseSchema>;
