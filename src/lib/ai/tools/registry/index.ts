import type { ToolExecutionResult } from "@/lib/ai/tools/result";
import type { ToolName } from "@/lib/ai/tools/definitions";
import type { ToolModule, ToolModuleRunContext } from "./types";
import { listMembersModule } from "./list-members";
import { listEventsModule } from "./list-events";
import { listAnnouncementsModule } from "./list-announcements";
import { listDiscussionsModule } from "./list-discussions";
import { listJobPostingsModule } from "./list-job-postings";
import { listChatGroupsModule } from "./list-chat-groups";
import { listAlumniModule } from "./list-alumni";
import { listEnterpriseAlumniModule } from "./list-enterprise-alumni";
import { listParentsModule } from "./list-parents";
import { listPhilanthropyEventsModule } from "./list-philanthropy-events";
import { listDonationsModule } from "./list-donations";
import { getOrgStatsModule } from "./get-org-stats";
import { getDonationAnalyticsModule } from "./get-donation-analytics";
import { listManagedOrgsModule } from "./list-managed-orgs";
import { listEnterpriseAuditEventsModule } from "./list-enterprise-audit-events";
import { getEnterpriseStatsModule } from "./get-enterprise-stats";
import { getEnterpriseQuotaModule } from "./get-enterprise-quota";
import { getEnterpriseOrgCapacityModule } from "./get-enterprise-org-capacity";
import { findNavigationTargetsModule } from "./find-navigation-targets";
import { suggestConnectionsModule } from "./suggest-connections";
import { suggestMentorsModule } from "./suggest-mentors";
import { listAvailableMentorsModule } from "./list-available-mentors";
import { prepareAnnouncementModule } from "./prepare-announcement";
import { prepareJobPostingModule } from "./prepare-job-posting";
import { prepareChatMessageModule } from "./prepare-chat-message";
import { prepareGroupMessageModule } from "./prepare-group-message";
import { prepareDiscussionReplyModule } from "./prepare-discussion-reply";
import { prepareDiscussionThreadModule } from "./prepare-discussion-thread";
import { prepareEventModule } from "./prepare-event";
import { prepareEventsBatchModule } from "./prepare-events-batch";
import { prepareEnterpriseInviteModule } from "./prepare-enterprise-invite";
import { revokeEnterpriseInviteModule } from "./revoke-enterprise-invite";
import { scrapeScheduleWebsiteModule } from "./scrape-schedule-website";
import { extractSchedulePdfModule } from "./extract-schedule-pdf";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MODULES: ReadonlyArray<ToolModule<any>> = [
  listMembersModule,
  listEventsModule,
  listAnnouncementsModule,
  listDiscussionsModule,
  listJobPostingsModule,
  listChatGroupsModule,
  listAlumniModule,
  listEnterpriseAlumniModule,
  listParentsModule,
  listPhilanthropyEventsModule,
  listDonationsModule,
  getOrgStatsModule,
  getDonationAnalyticsModule,
  listManagedOrgsModule,
  listEnterpriseAuditEventsModule,
  getEnterpriseStatsModule,
  getEnterpriseQuotaModule,
  getEnterpriseOrgCapacityModule,
  findNavigationTargetsModule,
  suggestConnectionsModule,
  suggestMentorsModule,
  listAvailableMentorsModule,
  prepareAnnouncementModule,
  prepareJobPostingModule,
  prepareChatMessageModule,
  prepareGroupMessageModule,
  prepareDiscussionReplyModule,
  prepareDiscussionThreadModule,
  prepareEventModule,
  prepareEventsBatchModule,
  prepareEnterpriseInviteModule,
  revokeEnterpriseInviteModule,
  scrapeScheduleWebsiteModule,
  extractSchedulePdfModule,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY: ReadonlyMap<string, ToolModule<any>> = new Map(
  MODULES.map((mod) => [mod.name, mod])
);

export function getToolModule(name: ToolName) {
  return REGISTRY.get(name);
}

export function isRegisteredTool(name: ToolName): boolean {
  return REGISTRY.has(name);
}

export async function dispatchToolModule(
  name: ToolName,
  rawArgs: unknown,
  run: ToolModuleRunContext
): Promise<ToolExecutionResult> {
  const mod = REGISTRY.get(name);
  if (!mod) {
    throw new Error(`No registered tool module for ${name}`);
  }
  // Args have already been validated upstream against the same schema; we
  // re-cast here to keep the registry boundary narrow without re-validating.
  return mod.execute(rawArgs as never, run);
}
