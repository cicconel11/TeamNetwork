import { z } from "zod";
import { baseSchemas } from "@/lib/security/validation";

// Forgot password form
export const forgotPasswordSchema = z.object({
  email: baseSchemas.email,
});
export type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

// Reset password form with confirmation
export const resetPasswordSchema = z
  .object({
    password: z.string().min(6, "Password must be at least 6 characters"),
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
  password: z.string().min(6, "Password must be at least 6 characters"),
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
