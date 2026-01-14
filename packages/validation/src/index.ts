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

// Re-export zod for consumers
export { z } from "zod";
