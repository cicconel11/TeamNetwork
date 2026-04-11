import { z } from "zod";
import { safeString } from "@/lib/security/validation";
import { mediaIdsSchema } from "./media";
import { createPollSchema } from "./chat-polls";


export const createPostSchema = z.object({
  body: z.string().trim().max(5000).default(""),
  mediaIds: mediaIdsSchema.optional(),
  poll: createPollSchema.optional(),
}).refine(
  (data) => data.poll || data.body.length >= 1,
  { message: "Post body is required", path: ["body"] },
);

export type CreatePostForm = z.infer<typeof createPostSchema>;

export const createCommentSchema = z.object({
  body: safeString(2000, 1),
});

export type CreateCommentForm = z.infer<typeof createCommentSchema>;
