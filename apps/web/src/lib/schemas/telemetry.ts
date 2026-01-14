import { z } from "zod";
import { safeString, optionalSafeString } from "@/lib/security/validation";

// Environment enum
export const telemetryEnvSchema = z.enum(["development", "staging", "production"]);
export type TelemetryEnv = z.infer<typeof telemetryEnvSchema>;

// Severity enum
export const telemetrySeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type TelemetrySeverity = z.infer<typeof telemetrySeveritySchema>;

// Breadcrumb type enum
export const breadcrumbTypeSchema = z.enum(["navigation", "network", "click", "console", "error"]);

// Breadcrumb schema
export const breadcrumbSchema = z.object({
  type: breadcrumbTypeSchema,
  timestamp: z.number().int().positive(),
  message: z.string().max(500),
  data: z.record(z.string(), z.unknown()).optional(),
});

// Browser metadata schema
const browserMetaSchema = z.object({
  userAgent: z.string().max(512),
  language: z.string().max(50),
  cookiesEnabled: z.boolean(),
});

// Viewport metadata schema
const viewportMetaSchema = z.object({
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  devicePixelRatio: z.number().positive(),
});

// Connection metadata schema (optional)
const connectionMetaSchema = z.object({
  effectiveType: z.string().max(20).optional(),
  downlink: z.number().nonnegative().optional(),
  rtt: z.number().int().nonnegative().optional(),
}).optional();

// Memory metadata schema (Chrome only, optional)
const memoryMetaSchema = z.object({
  jsHeapSizeLimit: z.number().int().nonnegative().optional(),
  totalJSHeapSize: z.number().int().nonnegative().optional(),
  usedJSHeapSize: z.number().int().nonnegative().optional(),
}).optional();

// Client metadata schema
export const clientMetaSchema = z.object({
  browser: browserMetaSchema,
  viewport: viewportMetaSchema,
  connection: connectionMetaSchema,
  memory: memoryMetaSchema,
});

// Error event payload schema for API validation (legacy/simple)
export const telemetryErrorEventSchema = z
  .object({
    // Required fields
    message: safeString(2000, 1),
    env: telemetryEnvSchema,

    // Optional fields
    name: optionalSafeString(100),
    stack: optionalSafeString(8000),
    route: optionalSafeString(500),
    api_path: optionalSafeString(500),
    component: optionalSafeString(200),
    user_id: optionalSafeString(100),
    session_id: optionalSafeString(100),
    severity: telemetrySeveritySchema.optional(),

    // Meta field with size limit (validated separately)
    meta: z
      .record(z.string(), z.unknown())
      .optional()
      .refine(
        (val) => {
          if (!val) return true;
          // Limit meta to 10KB when serialized
          const serialized = JSON.stringify(val);
          return serialized.length <= 10_240;
        },
        { message: "Meta field exceeds 10KB limit" }
      ),
  })
  .strict();

export type TelemetryErrorEventInput = z.infer<typeof telemetryErrorEventSchema>;

// Full client error payload schema (for client-side telemetry)
export const clientErrorPayloadSchema = z
  .object({
    // Required fields
    name: safeString(100, 1),
    message: safeString(2000, 1),
    route: safeString(500, 1),
    env: telemetryEnvSchema,
    session_id: safeString(100, 1),
    breadcrumbs: z.array(breadcrumbSchema).max(20),
    meta: clientMetaSchema,

    // Optional fields
    stack: optionalSafeString(10000),
    user_id: optionalSafeString(100),
    context: z
      .record(z.string(), z.unknown())
      .optional()
      .refine(
        (val) => {
          if (!val) return true;
          const serialized = JSON.stringify(val);
          return serialized.length <= 5_000;
        },
        { message: "Context field exceeds 5KB limit" }
      ),
  })
  .strict();

export type ClientErrorPayloadInput = z.infer<typeof clientErrorPayloadSchema>;
