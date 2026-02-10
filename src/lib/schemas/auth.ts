import { z } from "zod";
import { baseSchemas } from "@/lib/security/validation";
import { isStrongPassword, PASSWORD_REQUIREMENTS } from "@/lib/auth/password";

// Reusable strong password schema for signup and reset flows
const strongPasswordSchema = z
  .string()
  .min(6, "Password must be at least 6 characters")
  .refine(isStrongPassword, { message: PASSWORD_REQUIREMENTS });

// Forgot password form
export const forgotPasswordSchema = z.object({
  email: baseSchemas.email,
});
export type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

// Reset password form with confirmation
export const resetPasswordSchema = z
  .object({
    password: strongPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

// Login form
export const loginSchema = z.object({
  email: baseSchemas.email,
  password: z.string().min(1, "Password is required"),
});
export type LoginForm = z.infer<typeof loginSchema>;

// Signup form
export const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
  email: baseSchemas.email,
  password: strongPasswordSchema,
});
export type SignupForm = z.infer<typeof signupSchema>;

// Join organization form
export const joinOrgSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Invite code is required")
    .transform((val) => val.toUpperCase()),
});
export type JoinOrgForm = z.infer<typeof joinOrgSchema>;

// Account deletion request schema
export const deleteAccountSchema = z.object({
  confirmation: z.string().refine((val) => val === "DELETE MY ACCOUNT", {
    message: 'Please type "DELETE MY ACCOUNT" to confirm',
  }),
});
export type DeleteAccountForm = z.infer<typeof deleteAccountSchema>;

// Account deletion status response
export const deleteAccountStatusSchema = z.object({
  status: z.enum(["none", "pending", "completed"]),
  requestedAt: z.string().datetime().nullable(),
  scheduledDeletionAt: z.string().datetime().nullable(),
});
export type DeleteAccountStatus = z.infer<typeof deleteAccountStatusSchema>;

// Re-export age gate schema and types (in separate file for testability)
export { ageGateSchema, type AgeBracket, type AgeGateForm } from "./age-gate";
