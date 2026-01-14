import { z } from "zod";
import { safeString } from "@/lib/security/validation";
import { mediaIdsSchema } from "./media";

export const createThreadSchema = z.object({
  title: safeString(200, 5),
  body: safeString(10000, 10),
  mediaIds: mediaIdsSchema.optional(),
});

export type CreateThreadForm = z.infer<typeof createThreadSchema>;

export const createReplySchema = z.object({
  body: safeString(5000, 1),
});

export type CreateReplyForm = z.infer<typeof createReplySchema>;
