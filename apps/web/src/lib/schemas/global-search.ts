import { z } from "zod";
import { sanitizeIlikeInput } from "@/lib/security/validation";

export const globalSearchModeSchema = z.enum(["fast", "ai"]);

/** Trimmed search string for org keyword search (passed to SQL RPC). */
export const globalSearchQuerySchema = z
  .string()
  .trim()
  .min(2, "Enter at least two characters")
  .max(100)
  .transform((s) => sanitizeIlikeInput(s));

export const globalSearchApiParamsSchema = z
  .object({
    q: globalSearchQuerySchema,
    mode: globalSearchModeSchema.default("fast"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "ai" && v.q.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["q"],
        message: "AI mode requires at least 3 characters",
      });
    }
  });

export type GlobalSearchMode = z.infer<typeof globalSearchModeSchema>;
