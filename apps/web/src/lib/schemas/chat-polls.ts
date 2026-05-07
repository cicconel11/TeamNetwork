import { z } from "zod";
import { safeString } from "./common";

// Poll metadata: question + 2-6 options
export const pollOptionSchema = z.object({
  label: safeString(200),
});

/**
 * Schema for poll metadata as stored in the database.
 * Options are stored as objects with `label` properties (e.g., `{ label: "Yes" }`).
 */
export const pollMetadataSchema = z.object({
  question: safeString(500),
  options: z
    .array(pollOptionSchema)
    .min(2, "Poll must have at least 2 options")
    .max(6, "Poll can have at most 6 options"),
  allow_change: z.boolean().default(true),
});
export type PollMetadata = z.infer<typeof pollMetadataSchema>;

// Form field definition
export const chatFormFieldSchema = z.object({
  id: z.string().min(1).max(64),
  label: safeString(200),
  type: z.enum(["text", "select", "radio"]),
  required: z.boolean().default(false),
  options: z
    .array(safeString(200))
    .max(20)
    .optional(),
});
export type ChatFormField = z.infer<typeof chatFormFieldSchema>;

// Form metadata: title + 1-10 fields
export const formMetadataSchema = z.object({
  title: safeString(300),
  fields: z
    .array(chatFormFieldSchema)
    .min(1, "Form must have at least 1 field")
    .max(10, "Form can have at most 10 fields"),
});
export type FormMetadata = z.infer<typeof formMetadataSchema>;

// Vote submission: option_index 0-5
export const voteSchema = z.object({
  option_index: z.number().int().min(0).max(5),
});
export type VoteInput = z.infer<typeof voteSchema>;

// Form response: field_id → value map
export const chatFormResponseSchema = z.record(
  z.string().min(1).max(64),
  z.string().max(2000)
);
export type ChatFormResponseInput = z.infer<typeof chatFormResponseSchema>;

/**
 * Schema for creating a poll via the API.
 * Options are accepted as plain strings (e.g., `["Yes", "No"]`), which are
 * transformed to `{ label }` objects before storage.
 */
export const createPollSchema = z.object({
  question: z.string().trim().max(500).default(""),
  options: z
    .array(safeString(200))
    .min(2, "Poll must have at least 2 options")
    .max(6, "Poll can have at most 6 options"),
  allow_change: z.boolean().default(true),
});
export type CreatePollInput = z.infer<typeof createPollSchema>;

// Create form request
export const createFormSchema = z.object({
  title: safeString(300),
  fields: z
    .array(chatFormFieldSchema)
    .min(1, "Form must have at least 1 field")
    .max(10, "Form can have at most 10 fields"),
});
export type CreateFormInput = z.infer<typeof createFormSchema>;
