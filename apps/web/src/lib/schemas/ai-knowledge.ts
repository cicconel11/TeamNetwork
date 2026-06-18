import { z } from "zod";

/**
 * Audience tokens for knowledge documents. These align with the RAG audience
 * gate: non-admin roles get explicit allowlists from audienceFilterForRole()
 * (members / active_members / alumni). 'all' is unrestricted (visible to every
 * role). 'admins' is an admin-only token deliberately absent from every
 * non-admin allowlist, so only admins (who pass no audience filter) retrieve it.
 */
export const KNOWLEDGE_AUDIENCES = [
  "all",
  "members",
  "active_members",
  "alumni",
  "admins",
] as const;

export const knowledgeAudienceSchema = z.enum(KNOWLEDGE_AUDIENCES);

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

export const knowledgeDocumentCreateSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  body: z.string().trim().min(1, "Body is required").max(50_000, "Body is too long"),
  description: z.string().trim().max(2_000, "Description is too long").optional(),
  type: z.string().trim().max(100, "Type is too long").optional(),
  resource: z.string().trim().max(2_000, "Resource is too long").optional(),
  tags: z
    .array(z.string().trim().min(1).max(MAX_TAG_LENGTH))
    .max(MAX_TAGS, `At most ${MAX_TAGS} tags`)
    .optional(),
  audience: knowledgeAudienceSchema.default("all"),
});

export const knowledgeDocumentDeleteSchema = z.object({
  id: z.string().uuid("Invalid knowledge document id"),
});

export type KnowledgeDocumentCreateInput = z.infer<typeof knowledgeDocumentCreateSchema>;
export type KnowledgeDocumentDeleteInput = z.infer<typeof knowledgeDocumentDeleteSchema>;
export type KnowledgeAudience = z.infer<typeof knowledgeAudienceSchema>;
