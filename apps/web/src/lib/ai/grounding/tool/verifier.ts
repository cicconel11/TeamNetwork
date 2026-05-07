// Per-tool dispatcher for deterministic tool-result grounding. Each successful
// tool summary routes to its matching coverage check; failures are collected
// and returned together.

import type { ToolName } from "@/lib/ai/tools/definitions";
import {
  verifyDonationAnalytics,
  verifyListAnnouncements,
  verifyListDiscussions,
  verifyListDonations,
  verifyListEvents,
  verifyListJobPostings,
  verifyListMembers,
  verifyOrgStats,
  verifySuggestConnections,
  verifySuggestMentors,
} from "./claim-coverage";

export interface SuccessfulToolSummary {
  name: ToolName;
  data: unknown;
}

export interface ToolGroundingResult {
  grounded: boolean;
  failures: string[];
}

export interface VerifyToolBackedResponseInput {
  content: string;
  toolResults: SuccessfulToolSummary[];
  orgContext?: { hideDonorNames?: boolean };
}

export function verifyToolBackedResponse(
  input: VerifyToolBackedResponseInput
): ToolGroundingResult {
  const failures: string[] = [];
  const hasSuggestConnections = input.toolResults.some(
    (result) => result.name === "suggest_connections"
  );

  for (const result of input.toolResults) {
    switch (result.name) {
      case "get_org_stats":
        failures.push(...verifyOrgStats(input.content, result.data));
        break;
      case "get_donation_analytics":
        failures.push(...verifyDonationAnalytics(input.content, result.data));
        break;
      case "list_donations":
        failures.push(
          ...verifyListDonations(input.content, result.data, {
            hideDonorNames: input.orgContext?.hideDonorNames === true,
          })
        );
        break;
      case "list_members":
        if (!hasSuggestConnections) {
          failures.push(...verifyListMembers(input.content, result.data));
        }
        break;
      case "list_events":
        failures.push(...verifyListEvents(input.content, result.data));
        break;
      case "list_announcements":
        failures.push(...verifyListAnnouncements(input.content, result.data));
        break;
      case "list_discussions":
        failures.push(...verifyListDiscussions(input.content, result.data));
        break;
      case "list_job_postings":
        failures.push(...verifyListJobPostings(input.content, result.data));
        break;
      case "suggest_connections":
        failures.push(...verifySuggestConnections(input.content, result.data));
        break;
      case "suggest_mentors":
        failures.push(...verifySuggestMentors(input.content, result.data));
        break;
      default:
        // No grounding check for this tool
        break;
    }
  }

  return {
    grounded: failures.length === 0,
    failures,
  };
}
