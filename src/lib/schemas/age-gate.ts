import { z } from "zod";

// Age bracket for COPPA compliance
export type AgeBracket = "under_13" | "13_17" | "18_plus";

// Age gate form for DOB collection (COPPA neutral age gate)
export const ageGateSchema = z
  .object({
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    year: z
      .number()
      .int()
      .min(1900)
      .max(new Date().getFullYear()),
  })
  .refine(
    (data) => {
      const date = new Date(data.year, data.month - 1, data.day);
      return (
        date.getFullYear() === data.year &&
        date.getMonth() === data.month - 1 &&
        date.getDate() === data.day
      );
    },
    {
      message: "Please enter a valid date",
    }
  )
  .refine(
    (data) => {
      const date = new Date(data.year, data.month - 1, data.day);
      return date <= new Date();
    },
    {
      message: "Date cannot be in the future",
    }
  );

export type AgeGateForm = z.infer<typeof ageGateSchema>;
