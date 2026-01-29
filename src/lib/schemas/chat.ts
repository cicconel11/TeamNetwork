import { z } from "zod";
import { safeString, optionalSafeString } from "./common";

// New chat group form
export const newChatGroupSchema = z.object({
  name: safeString(100),
  description: optionalSafeString(500),
  member_ids: z
    .array(z.string().uuid())
    .min(1, { message: "Select at least one member" })
    .max(100, { message: "Maximum 100 members per group" }),
  is_private: z.boolean().default(false),
});
export type NewChatGroupForm = z.infer<typeof newChatGroupSchema>;

export const editChatGroupSchema = newChatGroupSchema;
export type EditChatGroupForm = z.infer<typeof editChatGroupSchema>;
