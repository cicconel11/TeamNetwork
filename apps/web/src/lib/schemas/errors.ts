import { z } from "zod";
import { safeString } from "./common";

// Error severity levels matching database constraint
export const errorSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type ErrorSeverity = z.infer<typeof errorSeveritySchema>;

// Environment values
export const errorEnvSchema = z.enum(["production", "staging", "development"]);
export type ErrorEnv = z.infer<typeof errorEnvSchema>;

// Single error event for ingest
export const errorEventSchema = z.object({
  name: safeString(100).optional(),
  message: safeString(2000),
  stack: z.string().max(10000).optional(),
  route: safeString(500).optional(),
  apiPath: safeString(500).optional(),
  severity: errorSeveritySchema.optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type ErrorEventInput = z.infer<typeof errorEventSchema>;

// Batch ingest request (up to 20 errors)
export const errorIngestRequestSchema = z.object({
  events: z.array(errorEventSchema).min(1).max(20),
  sessionId: safeString(64).optional(),
  env: errorEnvSchema.optional(),
});
export type ErrorIngestRequest = z.infer<typeof errorIngestRequestSchema>;

// Response from ingest endpoint
export const errorIngestResponseSchema = z.object({
  success: z.boolean(),
  processed: z.number(),
  errors: z.array(z.string()).optional(),
});
export type ErrorIngestResponse = z.infer<typeof errorIngestResponseSchema>;
