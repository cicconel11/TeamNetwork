import { z } from "zod";
import { safeString, optionalSafeString } from "./common";

// Add team to competition
export const addTeamSchema = z.object({
  name: safeString(100),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, { message: "Color must be a valid hex code" })
    .optional(),
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

// New competition form
export const newCompetitionSchema = z.object({
  name: safeString(200),
  description: optionalSafeString(1000),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Invalid date format" }).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Invalid date format" }).optional(),
});
export type NewCompetitionForm = z.infer<typeof newCompetitionSchema>;
