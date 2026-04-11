import { z } from "zod";
import { safeString, baseSchemas } from "./common";

// OAuth initiation — admin provides orgSlug, we redirect to Blackbaud
export const blackbaudAuthSchema = z
  .object({
    orgSlug: safeString(100),
  })
  .strict();
export type BlackbaudAuthRequest = z.infer<typeof blackbaudAuthSchema>;

// OAuth callback — Blackbaud redirects with code + state
export const blackbaudCallbackSchema = z
  .object({
    code: safeString(2048),
    state: baseSchemas.uuid,
  })
  .strict();
export type BlackbaudCallbackRequest = z.infer<typeof blackbaudCallbackSchema>;

// Manual sync trigger
export const blackbaudSyncSchema = z
  .object({
    syncType: z.enum(["full", "incremental"]).default("incremental"),
  })
  .strict();
export type BlackbaudSyncRequest = z.infer<typeof blackbaudSyncSchema>;

// Disconnect request
export const blackbaudDisconnectSchema = z
  .object({
    orgSlug: safeString(100),
  })
  .strict();
export type BlackbaudDisconnectRequest = z.infer<typeof blackbaudDisconnectSchema>;
