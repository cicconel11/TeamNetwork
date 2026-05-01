// Shared validation schemas and utilities for web and mobile
export {
  baseSchemas,
  safeString,
  optionalSafeString,
  optionalEmail,
  uuidArray,
  orgNameSchema,
  validateOrgName,
} from "./schemas";

export {
  alumniBucketSchema,
  subscriptionIntervalSchema,
  createOrgSchema,
} from "./organization";
export type {
  AlumniBucket,
  SubscriptionInterval,
  CreateOrgForm,
} from "./organization";

// Re-export zod for consumers
export { z } from "zod";
