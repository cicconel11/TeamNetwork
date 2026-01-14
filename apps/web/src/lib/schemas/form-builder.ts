import { z } from "zod";
import { safeString, optionalSafeString } from "./common";

// Field types for dynamic form builder
export const fieldTypeSchema = z.enum([
  "text",
  "email",
  "number",
  "date",
  "select",
  "multiselect",
  "checkbox",
  "textarea",
  "file",
]);
export type FieldType = z.infer<typeof fieldTypeSchema>;

// Individual field definition
export const formFieldSchema = z.object({
  id: z.string().uuid().optional(), // Generated on creation
  label: safeString(200),
  type: fieldTypeSchema,
  required: z.boolean().default(false),
  placeholder: optionalSafeString(200),
  options: z
    .array(
      z.object({
        label: safeString(100),
        value: safeString(100),
      })
    )
    .optional(), // For select/multiselect
  validation: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
    })
    .optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

// Form builder schema (for creating custom forms)
export const newFormSchema = z.object({
  title: safeString(200),
  description: optionalSafeString(1000),
  fields: z
    .array(formFieldSchema)
    .min(1, { message: "At least one field is required" })
    .max(50, { message: "Maximum 50 fields allowed" }),
  is_active: z.boolean().default(true),
  requires_auth: z.boolean().default(true),
  allow_multiple_submissions: z.boolean().default(false),
});
export type NewFormSchema = z.infer<typeof newFormSchema>;

export const editFormSchema = newFormSchema;
export type EditFormSchema = z.infer<typeof editFormSchema>;
