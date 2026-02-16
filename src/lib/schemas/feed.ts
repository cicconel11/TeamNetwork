import { z } from "zod";
import { safeString } from "@/lib/security/validation";

export const createPostSchema = z.object({
  body: safeString(5000, 1),
});

export type CreatePostForm = z.infer<typeof createPostSchema>;

export const createCommentSchema = z.object({
  body: safeString(2000, 1),
});

export type CreateCommentForm = z.infer<typeof createCommentSchema>;
