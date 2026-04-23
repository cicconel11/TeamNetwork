// Barrel for the tool-grounding validator. Splits the implementation across:
//   - tool-grounding/verifier.ts          → orchestrator + result types
//   - tool-grounding/claim-coverage.ts    → per-tool coverage checks
//   - tool-grounding/claim-extraction.ts  → reason-code extractors + types
// Plus the cross-validator primitives in grounding-primitives.ts.

export {
  verifyToolBackedResponse,
  type SuccessfulToolSummary,
  type ToolGroundingResult,
  type VerifyToolBackedResponseInput,
} from "./tool-grounding/verifier";

export type { ListDonationsGroundingContext } from "./tool-grounding/claim-coverage";

export {
  contentIsGroundingFallback,
  extractAllCurrencyDollars,
  extractEmails,
  extractListEntryHeads,
  extractMentionedDates,
  extractQuotedTitles,
  normalizeIdentifier,
  parseCurrencyClaim,
  stripMarkdown,
} from "./grounding-primitives";
