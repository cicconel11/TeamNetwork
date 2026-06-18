import { z } from "zod";
import { safeString, optionalSafeString, hexColorSchema } from "./common";

// Add team to competition
export const addTeamSchema = z.object({
  name: safeString(100),
  color: hexColorSchema.optional(),
});
export type AddTeamForm = z.infer<typeof addTeamSchema>;

// Add points to a team
export const addPointsSchema = z.object({
  team_id: z.string().uuid({ message: "Select a team" }),
  points: z
    .union([z.string(), z.number()])
    .transform((val) => {
      if (typeof val === "string") {
        const num = parseInt(val, 10);
        return isNaN(num) ? 0 : num;
      }
      return val;
    })
    .refine((val) => val !== 0, { message: "Points must not be zero" }),
  reason: optionalSafeString(200),
});
export type AddPointsForm = z.infer<typeof addPointsSchema>;

// Client-side validation for the "Add Points" admin form, where a team can be
// chosen from the list (team_id) OR typed as a new name (team_name), and points
// must be a whole number (negatives allowed).
export const addPointsFormSchema = z
  .object({
    team_id: z.string().optional().default(""),
    team_name: optionalSafeString(100),
    points: z
      .string()
      .trim()
      .min(1, { message: "Enter a points value" })
      .regex(/^-?\d+$/, { message: "Points must be a whole number (negatives allowed)" }),
    reason: optionalSafeString(200),
    notes: optionalSafeString(1000),
  })
  .refine((d) => Boolean(d.team_id) || Boolean(d.team_name?.trim()), {
    message: "Select a team or enter a team name",
    path: ["team_id"],
  });
export type AddPointsFormValues = z.infer<typeof addPointsFormSchema>;

// New competition form
export const newCompetitionSchema = z.object({
  name: safeString(200),
  description: optionalSafeString(1000),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Invalid date format" }).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Invalid date format" }).optional(),
});
export type NewCompetitionForm = z.infer<typeof newCompetitionSchema>;
