import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONNECTION_PROMPT_PATTERN,
  MENTOR_PROMPT_PATTERN,
  MENTOR_AVAILABILITY_PROMPT_PATTERN,
  DIRECT_NAVIGATION_PROMPT_PATTERN,
  CONTENT_SEARCH_PROMPT_PATTERN,
  CREATE_ANNOUNCEMENT_PROMPT_PATTERN,
  CREATE_JOB_PROMPT_PATTERN,
  SEND_CHAT_MESSAGE_PROMPT_PATTERN,
  LIST_CHAT_GROUPS_PROMPT_PATTERN,
  SEND_GROUP_CHAT_MESSAGE_PROMPT_PATTERN,
  CREATE_DISCUSSION_PROMPT_PATTERN,
  DISCUSSION_REPLY_PROMPT_PATTERN,
  CREATE_EVENT_PROMPT_PATTERN,
  EXPLICIT_EVENT_DRAFT_SWITCH_PATTERN,
  MEMBER_COUNT_PROMPT_PATTERN,
  MEMBER_ROSTER_PROMPT_PATTERN,
  SCRAPE_SCHEDULE_PROMPT_PATTERN,
  PDF_SCHEDULE_PROMPT_PATTERN,
  ALUMNI_ROSTER_PROMPT_PATTERN,
  DONATION_STATS_PROMPT_PATTERN,
  DONATION_ANALYTICS_PROMPT_PATTERN,
  DONATION_LIST_PROMPT_PATTERN,
  PARENT_LIST_PROMPT_PATTERN,
  PHILANTHROPY_EVENTS_PROMPT_PATTERN,
  ENTERPRISE_SCOPE_PROMPT_PATTERN,
  ENTERPRISE_QUOTA_PROMPT_PATTERN,
  ENTERPRISE_SUB_ORG_CAPACITY_PROMPT_PATTERN,
  MANAGED_ORGS_PROMPT_PATTERN,
  ENTERPRISE_AUDIT_PROMPT_PATTERN,
  ENTERPRISE_INVITE_CREATE_PROMPT_PATTERN,
  ENTERPRISE_INVITE_REVOKE_PROMPT_PATTERN,
  HTTPS_URL_PATTERN,
  ANNOUNCEMENT_DETAIL_FALLBACK_PATTERN,
  CHAT_MESSAGE_FALLBACK_PATTERN,
  GROUP_CHAT_MESSAGE_FALLBACK_PATTERN,
  DISCUSSION_REPLY_FALLBACK_PATTERN,
  DIRECT_QUERY_START_PATTERN,
  looksLikeStructuredJobDraft,
  getPass1Tools,
  getForcedPass1ToolChoice,
  isToolFirstEligible,
  deriveOrgStatsScope,
  deriveDonationAnalyticsDimension,
  deriveSearchOrgContentQuery,
  deriveNavigationQuery,
  deriveForcedPass1ToolArgs,
} from "../src/app/api/ai/[orgId]/chat/handler/pass1-tools";
import type { CacheSurface } from "../src/lib/ai/semantic-cache-utils";
import type { TurnExecutionPolicy } from "../src/lib/ai/turn-execution-policy";
import type { EnterpriseRole } from "../src/types/enterprise";
import type { ChatAttachment } from "../src/app/api/ai/[orgId]/chat/handler/shared";

type ToolPolicy = TurnExecutionPolicy["toolPolicy"];
type IntentType = TurnExecutionPolicy["intentType"];

interface CascadeRow {
  name: string;
  message: string;
  surface: CacheSurface;
  toolPolicy: ToolPolicy;
  intentType: IntentType;
  attachment?: ChatAttachment;
  currentPath?: string;
  enterpriseEnabled?: boolean;
  enterpriseRole?: EnterpriseRole;
  expectedToolNames: string[];
  expectedForcedTool?: string;
}

function namesOf(tools: ReturnType<typeof getPass1Tools>): string[] {
  return (tools ?? []).map((t) => t.function.name);
}

describe("getPass1Tools — tool-policy gate", () => {
  const policies: ToolPolicy[] = ["none"];
  for (const policy of policies) {
    it(`returns undefined when toolPolicy=${policy}`, () => {
      const result = getPass1Tools(
        "create an announcement",
        "general",
        policy,
        "action_request",
      );
      assert.equal(result, undefined);
    });
  }

  it("knowledge_only-style policy (none) suppresses action tools even with CREATE_* match", () => {
    const result = getPass1Tools(
      "create an announcement about the meeting",
      "general",
      "none",
      "action_request",
    );
    assert.equal(result, undefined);
  });
});

describe("getPass1Tools — single-tool cascade priorities", () => {
  const rows: CascadeRow[] = [
    {
      name: "CREATE_ANNOUNCEMENT → prepare_announcement",
      message: "create an announcement about Friday's game",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "action_request",
      expectedToolNames: ["prepare_announcement"],
      expectedForcedTool: "prepare_announcement",
    },
    {
      name: "CREATE_JOB → prepare_job_posting",
      message: "post a new job opening for a coach",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "action_request",
      expectedToolNames: ["prepare_job_posting"],
      expectedForcedTool: "prepare_job_posting",
    },
    {
      name: "structured job draft → prepare_job_posting",
      message:
        "Job: Head Coach\nLocation type: remote\nExperience level: senior\nDescription: lead the team and manage practices and recruit",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "action_request",
      expectedToolNames: ["prepare_job_posting"],
      expectedForcedTool: "prepare_job_posting",
    },
    {
      name: "LIST_CHAT_GROUPS → list_chat_groups",
      message: "show me my chat groups",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "knowledge_query",
      expectedToolNames: ["list_chat_groups"],
      expectedForcedTool: "list_chat_groups",
    },
    {
      name: "SEND_GROUP_CHAT_MESSAGE → prepare_group_message",
      message: "send a message to the coaches group",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "action_request",
      expectedToolNames: ["prepare_group_message"],
      expectedForcedTool: "prepare_group_message",
    },
    {
      name: "SEND_CHAT_MESSAGE → prepare_chat_message",
      message: "send a dm to John Smith",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "action_request",
      expectedToolNames: ["prepare_chat_message"],
      expectedForcedTool: "prepare_chat_message",
    },
    {
      name: "DISCUSSION_REPLY → prepare_discussion_reply",
      message: "draft a reply to the recent discussion",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "action_request",
      expectedToolNames: ["prepare_discussion_reply"],
      expectedForcedTool: "prepare_discussion_reply",
    },
    {
      name: "CREATE_DISCUSSION → prepare_discussion_thread",
      message: "start a new discussion thread about budgets",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "action_request",
      expectedToolNames: ["prepare_discussion_thread"],
      expectedForcedTool: "prepare_discussion_thread",
    },
    {
      name: "PDF_SCHEDULE prompt → extract_schedule_pdf",
      message: "extract the schedule from this pdf file",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "action_request",
      expectedToolNames: ["extract_schedule_pdf"],
      expectedForcedTool: "extract_schedule_pdf",
    },
    {
      name: "schedule attachment alone → extract_schedule_pdf",
      message: "here you go",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "action_request",
      attachment: {
        storagePath: "x",
        fileName: "sched.pdf",
        mimeType: "application/pdf",
      },
      expectedToolNames: ["extract_schedule_pdf"],
      expectedForcedTool: "extract_schedule_pdf",
    },
    {
      name: "SCRAPE_SCHEDULE prompt → scrape_schedule_website",
      message: "scrape the schedule from https://example.com/calendar",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "action_request",
      expectedToolNames: ["scrape_schedule_website"],
      expectedForcedTool: "scrape_schedule_website",
    },
    {
      name: "URL + create event → scrape_schedule_website",
      message: "add an event from https://team.example.com/games",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "action_request",
      expectedToolNames: ["scrape_schedule_website"],
      expectedForcedTool: "scrape_schedule_website",
    },
    {
      name: "CREATE_EVENT single → prepare_event",
      message: "create an event for Friday at 7pm",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "action_request",
      expectedToolNames: ["prepare_event"],
      expectedForcedTool: "prepare_event",
    },
    {
      name: "CREATE_EVENT multi → prepare_events_batch + prepare_event",
      message: "create three event entries for next week",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "action_request",
      expectedToolNames: ["prepare_events_batch", "prepare_event"],
      expectedForcedTool: undefined,
    },
    {
      name: "DIRECT_NAVIGATION + navigation intent → find_navigation_targets",
      message: "go to the members page",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "navigation",
      expectedToolNames: ["find_navigation_targets"],
      expectedForcedTool: "find_navigation_targets",
    },
    {
      name: "CONTENT_SEARCH prompt → search_org_content",
      message: "search announcements about fundraising",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "knowledge_query",
      expectedToolNames: ["search_org_content"],
      expectedForcedTool: "search_org_content",
    },
    {
      name: "DIRECT_NAVIGATION without navigation intent falls through",
      message: "go to the members page", // matches DIRECT_NAVIGATION but intentType is knowledge
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "knowledge_query",
      // falls into surface defaults for general (with globals merged in)
      expectedToolNames: [
        "list_members",
        "list_events",
        "list_announcements",
        "list_discussions",
        "list_job_postings",
        "list_alumni",
        "list_parents",
        "list_philanthropy_events",
        "list_donations",
        "get_org_stats",
        "suggest_connections",
        "list_available_mentors",
        "suggest_mentors",
        "search_org_content",
        "find_navigation_targets",
      ],
    },
    {
      name: "MENTOR on members surface → suggest_mentors",
      message: "find a mentor for me",
      surface: "members",
      toolPolicy: "surface_read_tools",
      intentType: "knowledge_query",
      expectedToolNames: ["suggest_mentors"],
    },
    {
      name: "MENTOR + availability on members → list_available_mentors",
      message: "which mentors are accepting new mentees",
      surface: "members",
      toolPolicy: "surface_read_tools",
      intentType: "knowledge_query",
      expectedToolNames: ["list_available_mentors"],
    },
    {
      name: "CONNECTION on members surface → suggest_connections",
      message: "suggest some connections for networking",
      surface: "members",
      toolPolicy: "surface_read_tools",
      intentType: "knowledge_query",
      expectedToolNames: ["suggest_connections"],
    },
    {
      name: "ALUMNI roster (no count) → list_alumni",
      message: "show me alumni from the class of 2010",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "knowledge_query",
      expectedToolNames: ["list_alumni"],
      expectedForcedTool: "list_alumni",
    },
    {
      name: "PARENT list → list_parents",
      message: "show me the parent directory",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "knowledge_query",
      expectedToolNames: ["list_parents"],
      expectedForcedTool: "list_parents",
    },
    {
      name: "PHILANTHROPY events → list_philanthropy_events",
      message: "list the philanthropy events",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "knowledge_query",
      expectedToolNames: ["list_philanthropy_events"],
      expectedForcedTool: "list_philanthropy_events",
    },
    {
      name: "DONATION analytics → get_donation_analytics",
      message: "show donation trends by month",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "knowledge_query",
      expectedToolNames: ["get_donation_analytics"],
      expectedForcedTool: "get_donation_analytics",
    },
    {
      name: "DONATION list → list_donations",
      message: "list the donors",
      surface: "general",
      toolPolicy: "surface_read_tools",
      intentType: "knowledge_query",
      expectedToolNames: ["list_donations"],
      expectedForcedTool: "list_donations",
    },
    {
      name: "MEMBER_COUNT on members surface → get_org_stats",
      message: "how many active members do we have?",
      surface: "members",
      toolPolicy: "surface_read_tools",
      intentType: "knowledge_query",
      expectedToolNames: ["get_org_stats"],
      expectedForcedTool: "get_org_stats",
    },
    {
      name: "MEMBER_ROSTER on members surface → list_members",
      message: "tell me about our members",
      surface: "members",
      toolPolicy: "surface_read_tools",
      intentType: "knowledge_query",
      expectedToolNames: ["list_members"],
      expectedForcedTool: "list_members",
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      const tools = getPass1Tools(
        row.message,
        row.surface,
        row.toolPolicy,
        row.intentType,
        row.attachment,
        row.currentPath,
        row.enterpriseEnabled,
        row.enterpriseRole,
      );
      assert.deepEqual(namesOf(tools), row.expectedToolNames);
      const forced = getForcedPass1ToolChoice(tools);
      if (row.expectedForcedTool) {
        assert.deepEqual(forced, {
          type: "function",
          function: { name: row.expectedForcedTool },
        });
      } else {
        assert.equal(forced, undefined);
      }
    });
  }
});

describe("getPass1Tools — enterprise scoped cascade", () => {
  const enterprisePath = "/enterprise/acme/dashboard";

  it("ENTERPRISE_INVITE_REVOKE on enterprise portal → revoke_enterprise_invite", () => {
    const tools = getPass1Tools(
      "revoke the enterprise invite for jane@example.com",
      "general",
      "surface_read_tools",
      "action_request",
      undefined,
      enterprisePath,
      true,
      "owner",
    );
    assert.deepEqual(namesOf(tools), ["revoke_enterprise_invite"]);
  });

  it("ENTERPRISE_INVITE_CREATE on enterprise portal → prepare_enterprise_invite", () => {
    const tools = getPass1Tools(
      "invite a new admin to the enterprise",
      "general",
      "surface_read_tools",
      "action_request",
      undefined,
      enterprisePath,
      true,
      "owner",
    );
    assert.deepEqual(namesOf(tools), ["prepare_enterprise_invite"]);
  });

  it("ENTERPRISE_AUDIT on enterprise portal → list_enterprise_audit_events", () => {
    const tools = getPass1Tools(
      "who approved the latest org adoption?",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      enterprisePath,
      true,
      "owner",
    );
    assert.deepEqual(namesOf(tools), ["list_enterprise_audit_events"]);
  });

  it("billing path + can-manage-billing → get_enterprise_quota", () => {
    const tools = getPass1Tools(
      "show me current usage",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      "/enterprise/acme/billing",
      true,
      "billing_admin",
    );
    assert.deepEqual(namesOf(tools), ["get_enterprise_quota"]);
  });

  it("ENTERPRISE_QUOTA prompt without billing perms but sub-org capacity → get_enterprise_org_capacity", () => {
    const tools = getPass1Tools(
      "what's our seat capacity across managed orgs?",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      enterprisePath,
      true,
      "org_admin",
    );
    assert.deepEqual(namesOf(tools), ["get_enterprise_org_capacity"]);
  });

  it("ENTERPRISE_QUOTA prompt without billing perms or sub-org capacity → get_enterprise_quota fallback", () => {
    const tools = getPass1Tools(
      "what's our remaining quota?",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      enterprisePath,
      true,
      "org_admin",
    );
    assert.deepEqual(namesOf(tools), ["get_enterprise_quota"]);
  });

  it("organizations path → list_managed_orgs", () => {
    const tools = getPass1Tools(
      "show overview",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      "/enterprise/acme/organizations",
      true,
      "owner",
    );
    assert.deepEqual(namesOf(tools), ["list_managed_orgs"]);
  });

  it("MANAGED_ORGS prompt on enterprise portal → list_managed_orgs", () => {
    const tools = getPass1Tools(
      "list the managed orgs",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      enterprisePath,
      true,
      "owner",
    );
    assert.deepEqual(namesOf(tools), ["list_managed_orgs"]);
  });

  it("alumni path on enterprise portal → list_enterprise_alumni", () => {
    const tools = getPass1Tools(
      "show me everyone",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      "/enterprise/acme/alumni",
      true,
      "owner",
    );
    assert.deepEqual(namesOf(tools), ["list_enterprise_alumni"]);
  });

  it("ALUMNI roster + count on enterprise portal → get_enterprise_stats", () => {
    const tools = getPass1Tools(
      "how many alumni do we have across orgs?",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      "/enterprise/acme/alumni",
      true,
      "owner",
    );
    assert.deepEqual(namesOf(tools), ["get_enterprise_stats"]);
  });

  it("ENTERPRISE_SCOPE keyword off-portal still routes when enterpriseEnabled", () => {
    const tools = getPass1Tools(
      "list managed orgs across all organizations",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      "/some-org/feed",
      true,
      "owner",
    );
    assert.deepEqual(namesOf(tools), ["list_managed_orgs"]);
  });

  it("enterpriseEnabled=false bypasses the enterprise branch entirely", () => {
    const tools = getPass1Tools(
      "list managed orgs across all organizations",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      enterprisePath,
      false,
      "owner",
    );
    // Falls through to general surface defaults
    assert.equal(namesOf(tools).includes("list_managed_orgs"), false);
  });
});

describe("getPass1Tools — context-gated fallbacks", () => {
  it("announcement-detail fallback on /orgSlug/announcements → prepare_announcement", () => {
    const tools = getPass1Tools(
      "title is Welcome and audience all members",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      "/myorg/announcements",
    );
    assert.deepEqual(namesOf(tools), ["prepare_announcement"]);
  });

  it("announcement-detail fallback suppressed when message starts with question word", () => {
    const tools = getPass1Tools(
      "show the title and audience",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      "/myorg/announcements",
    );
    // "show" matches DIRECT_QUERY_START_PATTERN → suppressed
    assert.equal(namesOf(tools).includes("prepare_announcement"), false);
  });

  it("announcement-detail fallback suppressed when message ends with '?'", () => {
    const tools = getPass1Tools(
      "what is the title and audience?",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      "/myorg/announcements",
    );
    assert.equal(namesOf(tools).includes("prepare_announcement"), false);
  });

  it("chat-message fallback on member route → prepare_chat_message", () => {
    const tools = getPass1Tools(
      "message this person about practice tomorrow",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      "/myorg/members/abc-123",
    );
    assert.deepEqual(namesOf(tools), ["prepare_chat_message"]);
  });

  it("group-chat fallback on /orgSlug/messages → prepare_group_message", () => {
    const tools = getPass1Tools(
      "send to the coaches group practice is moved",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      "/myorg/messages",
    );
    assert.deepEqual(namesOf(tools), ["prepare_group_message"]);
  });

  it("discussion-reply fallback on discussion thread route → prepare_discussion_reply", () => {
    const tools = getPass1Tools(
      "reply that I agree with the proposal",
      "general",
      "surface_read_tools",
      "knowledge_query",
      undefined,
      "/myorg/discussions/thread-789",
    );
    assert.deepEqual(namesOf(tools), ["prepare_discussion_reply"]);
  });
});

describe("getPass1Tools — surface defaults", () => {
  it("general surface returns full read tool set with global read tools appended", () => {
    const tools = getPass1Tools(
      "summarize the latest happenings",
      "general",
      "surface_read_tools",
      "knowledge_query",
    );
    assert.deepEqual(namesOf(tools), [
      "list_members",
      "list_events",
      "list_announcements",
      "list_discussions",
      "list_job_postings",
      "list_alumni",
      "list_parents",
      "list_philanthropy_events",
      "list_donations",
      "get_org_stats",
      "suggest_connections",
      "list_available_mentors",
      "suggest_mentors",
      "search_org_content",
      "find_navigation_targets",
    ]);
  });

  it("members surface (no other match) returns members read tool set with globals appended", () => {
    const tools = getPass1Tools(
      "what is going on around here",
      "members",
      "surface_read_tools",
      "knowledge_query",
    );
    assert.deepEqual(namesOf(tools), [
      "list_members",
      "list_alumni",
      "list_parents",
      "get_org_stats",
      "suggest_connections",
      "list_available_mentors",
      "suggest_mentors",
      "search_org_content",
      "find_navigation_targets",
    ]);
  });

  it("analytics surface returns get_org_stats with globals so cross-domain queries resolve", () => {
    const tools = getPass1Tools(
      "what is the latest update",
      "analytics",
      "surface_read_tools",
      "knowledge_query",
    );
    assert.deepEqual(namesOf(tools), [
      "get_org_stats",
      "search_org_content",
      "find_navigation_targets",
      "list_members",
      "list_alumni",
      "list_parents",
    ]);
  });

  it("events surface returns list_events with globals so cross-domain queries resolve", () => {
    const tools = getPass1Tools(
      "what is happening",
      "events",
      "surface_read_tools",
      "knowledge_query",
    );
    assert.deepEqual(namesOf(tools), [
      "list_events",
      "search_org_content",
      "find_navigation_targets",
      "list_members",
      "list_alumni",
      "list_parents",
    ]);
  });
});

describe("getPass1Tools — surface global read merge (regression for surface routing fix)", () => {
  it("events surface still leads with list_events for ambiguous prompt", () => {
    const tools = getPass1Tools(
      "what's on the calendar this week",
      "events",
      "surface_read_tools",
      "knowledge_query",
    );
    const names = namesOf(tools);
    assert.equal(names[0], "list_events", "list_events must come first to preserve surface bias");
    assert.ok(names.includes("search_org_content"));
    assert.ok(names.includes("list_members"));
  });

  it("events surface exposes people/search tools so cross-domain queries route correctly", () => {
    const tools = getPass1Tools(
      "find anything about Louis Ciccone",
      "events",
      "surface_read_tools",
      "live_lookup",
    );
    const names = namesOf(tools);
    assert.ok(names.includes("list_members"));
    assert.ok(names.includes("search_org_content"));
    assert.ok(names.length > 1, "events surface must no longer be locked to a single tool");
  });

  it("analytics surface exposes search_org_content so content searches do not route to get_org_stats", () => {
    const tools = getPass1Tools(
      "find posts mentioning fundraising",
      "analytics",
      "surface_read_tools",
      "live_lookup",
    );
    const names = namesOf(tools);
    assert.deepEqual(names, ["search_org_content"]);
  });

  it("members surface dedupes — list_members appears exactly once", () => {
    const tools = getPass1Tools(
      "what is going on around here",
      "members",
      "surface_read_tools",
      "knowledge_query",
    );
    const names = namesOf(tools);
    const occurrences = names.filter((n) => n === "list_members").length;
    assert.equal(occurrences, 1, "global merge must dedupe with surface-specific entries");
  });

  it("forced single-tool override still single-tool when CREATE_EVENT_PROMPT matches on events surface", () => {
    const tools = getPass1Tools(
      "schedule a meeting tomorrow at 3pm",
      "events",
      "surface_read_tools",
      "action_request",
    );
    assert.deepEqual(namesOf(tools), ["prepare_event"]);
  });

  it("every surface contains all five global read tools", () => {
    const surfaces: CacheSurface[] = ["general", "members", "analytics", "events"];
    const required = [
      "search_org_content",
      "find_navigation_targets",
      "list_members",
      "list_alumni",
      "list_parents",
    ];
    for (const surface of surfaces) {
      const tools = getPass1Tools(
        "tell me anything",
        surface,
        "surface_read_tools",
        "knowledge_query",
      );
      const names = namesOf(tools);
      for (const tool of required) {
        assert.ok(
          names.includes(tool),
          `surface=${surface} must include ${tool} in its merged pass-1 tool list (got: ${names.join(", ")})`,
        );
      }
    }
  });
});

describe("looksLikeStructuredJobDraft", () => {
  it("returns true for a draft with job context + 2 structured fields + length", () => {
    const draft =
      "Job title: Head Coach\nLocation type: hybrid\nExperience level: senior\nDescription: lead the team and run weekly practices and recruit new members";
    assert.equal(looksLikeStructuredJobDraft(draft), true);
  });

  it("returns true when URL counts as a structured field", () => {
    const draft =
      "Coaching role open at our club. Application url: https://example.com/apply\nContact email: hr@example.com\nDescription: please apply soon for this exciting opportunity";
    assert.equal(looksLikeStructuredJobDraft(draft), true);
  });

  it("returns false when the message is too short", () => {
    const draft = "Job: Coach\nlocation type: remote\nlink: https://x.com";
    assert.equal(looksLikeStructuredJobDraft(draft), false);
  });

  it("returns false without job context keywords", () => {
    const draft =
      "Location type: remote\nExperience level: senior\nDescription: this is just a generic message about something unrelated with enough text to clear the length floor";
    assert.equal(looksLikeStructuredJobDraft(draft), false);
  });

  it("returns false with only one structured field", () => {
    const draft =
      "We have a new job opening for a coach. Description: an exciting role at our club working with athletes and coaches across the program";
    assert.equal(looksLikeStructuredJobDraft(draft), false);
  });

  it("returns false for plain conversational text", () => {
    const draft = "hey, do we have any job openings right now?";
    assert.equal(looksLikeStructuredJobDraft(draft), false);
  });
});

describe("getForcedPass1ToolChoice", () => {
  it("returns undefined when tools is undefined", () => {
    assert.equal(getForcedPass1ToolChoice(undefined), undefined);
  });

  it("returns undefined when more than one tool", () => {
    const tools = getPass1Tools(
      "create 3 events for next week",
      "general",
      "surface_read_tools",
      "action_request",
    );
    // multi-event branch returns 2 tools
    assert.equal(getForcedPass1ToolChoice(tools), undefined);
  });

  it("returns function choice for an allowlisted single tool", () => {
    const tools = getPass1Tools(
      "create an announcement",
      "general",
      "surface_read_tools",
      "action_request",
    );
    assert.deepEqual(getForcedPass1ToolChoice(tools), {
      type: "function",
      function: { name: "prepare_announcement" },
    });
  });

  it("returns undefined for a single tool not on the forced allowlist", () => {
    const tools = getPass1Tools(
      "find a mentor for me",
      "members",
      "surface_read_tools",
      "knowledge_query",
    );
    // suggest_mentors is not in the forced allowlist
    assert.deepEqual(namesOf(tools), ["suggest_mentors"]);
    assert.equal(getForcedPass1ToolChoice(tools), undefined);
  });
});

describe("isToolFirstEligible", () => {
  it("returns false for undefined", () => {
    assert.equal(isToolFirstEligible(undefined), false);
  });

  it("returns false for multi-tool result", () => {
    const tools = getPass1Tools(
      "create 3 events for next week",
      "general",
      "surface_read_tools",
      "action_request",
    );
    assert.equal(isToolFirstEligible(tools), false);
  });

  it("returns true for an eligible single tool (list_members)", () => {
    const tools = getPass1Tools(
      "tell me about our members",
      "members",
      "surface_read_tools",
      "knowledge_query",
    );
    assert.deepEqual(namesOf(tools), ["list_members"]);
    assert.equal(isToolFirstEligible(tools), true);
  });

  it("returns true for find_navigation_targets", () => {
    const tools = getPass1Tools(
      "go to the members page",
      "general",
      "surface_read_tools",
      "navigation",
    );
    assert.deepEqual(namesOf(tools), ["find_navigation_targets"]);
    assert.equal(isToolFirstEligible(tools), true);
  });

  it("returns true for search_org_content", () => {
    const tools = getPass1Tools(
      "search announcements about gala",
      "general",
      "surface_read_tools",
      "knowledge_query",
    );
    assert.deepEqual(namesOf(tools), ["search_org_content"]);
    assert.equal(isToolFirstEligible(tools), true);
  });

  it("returns false for prepare_announcement (action draft, not a read)", () => {
    const tools = getPass1Tools(
      "create an announcement",
      "general",
      "surface_read_tools",
      "action_request",
    );
    assert.deepEqual(namesOf(tools), ["prepare_announcement"]);
    assert.equal(isToolFirstEligible(tools), false);
  });
});

// Coverage assertion: every exported PATTERN constant referenced
// somewhere in this file (directly or as a regex used by getPass1Tools).
describe("pattern export coverage", () => {
  it("references every PATTERN export at least once", () => {
    const patterns = [
      CONNECTION_PROMPT_PATTERN,
      MENTOR_PROMPT_PATTERN,
      MENTOR_AVAILABILITY_PROMPT_PATTERN,
      DIRECT_NAVIGATION_PROMPT_PATTERN,
      CREATE_ANNOUNCEMENT_PROMPT_PATTERN,
      CREATE_JOB_PROMPT_PATTERN,
      SEND_CHAT_MESSAGE_PROMPT_PATTERN,
      LIST_CHAT_GROUPS_PROMPT_PATTERN,
      SEND_GROUP_CHAT_MESSAGE_PROMPT_PATTERN,
      CREATE_DISCUSSION_PROMPT_PATTERN,
      DISCUSSION_REPLY_PROMPT_PATTERN,
      CREATE_EVENT_PROMPT_PATTERN,
      EXPLICIT_EVENT_DRAFT_SWITCH_PATTERN,
      MEMBER_COUNT_PROMPT_PATTERN,
      MEMBER_ROSTER_PROMPT_PATTERN,
      SCRAPE_SCHEDULE_PROMPT_PATTERN,
      PDF_SCHEDULE_PROMPT_PATTERN,
      ALUMNI_ROSTER_PROMPT_PATTERN,
      DONATION_STATS_PROMPT_PATTERN,
      DONATION_ANALYTICS_PROMPT_PATTERN,
      DONATION_LIST_PROMPT_PATTERN,
      PARENT_LIST_PROMPT_PATTERN,
      PHILANTHROPY_EVENTS_PROMPT_PATTERN,
      ENTERPRISE_SCOPE_PROMPT_PATTERN,
      ENTERPRISE_QUOTA_PROMPT_PATTERN,
      ENTERPRISE_SUB_ORG_CAPACITY_PROMPT_PATTERN,
      MANAGED_ORGS_PROMPT_PATTERN,
      ENTERPRISE_AUDIT_PROMPT_PATTERN,
      ENTERPRISE_INVITE_CREATE_PROMPT_PATTERN,
      ENTERPRISE_INVITE_REVOKE_PROMPT_PATTERN,
      HTTPS_URL_PATTERN,
      ANNOUNCEMENT_DETAIL_FALLBACK_PATTERN,
      CHAT_MESSAGE_FALLBACK_PATTERN,
      GROUP_CHAT_MESSAGE_FALLBACK_PATTERN,
      DISCUSSION_REPLY_FALLBACK_PATTERN,
      DIRECT_QUERY_START_PATTERN,
    ];
    for (const p of patterns) {
      assert.ok(p instanceof RegExp);
    }
    // EXPLICIT_EVENT_DRAFT_SWITCH_PATTERN is exported for external use
    // (pending-event-revision); assert it matches a sample.
    assert.ok(EXPLICIT_EVENT_DRAFT_SWITCH_PATTERN.test("create an event for Friday"));
  });
});

describe("deriveOrgStatsScope", () => {
  const cases: Array<[string, string]> = [
    ["how many active members", "members"],
    ["how many members do we have", "members"],
    ["how many alumni", "alumni"],
    ["count of graduates", "alumni"],
    ["how many parents", "parents"],
    ["number of guardians", "parents"],
    ["how many upcoming events", "events"],
    ["how many donors", "donations"],
    ["total donations this year", "donations"],
    ["org stats overview", "all"],
    ["snapshot please", "all"],
  ];
  for (const [message, expected] of cases) {
    it(`maps "${message}" → ${expected}`, () => {
      assert.equal(deriveOrgStatsScope(message), expected);
    });
  }
});

describe("deriveDonationAnalyticsDimension", () => {
  const cases: Array<[string, string]> = [
    ["show donation trends by month", "trend"],
    ["donations over time", "trend"],
    ["monthly donation breakdown", "trend"],
    ["what purposes are donors giving to", "top_purposes"],
    ["donations by category", "top_purposes"],
    ["status mix of donations", "status_mix"],
    ["how many failed donations", "status_mix"],
    ["total donations raised", "totals"],
    ["largest donation this quarter", "totals"],
    ["donation analytics", "all"],
    ["donor performance overview", "all"],
  ];
  for (const [message, expected] of cases) {
    it(`maps "${message}" → ${expected}`, () => {
      assert.equal(deriveDonationAnalyticsDimension(message), expected);
    });
  }
});

describe("deriveForcedPass1ToolArgs", () => {
  it("returns scope for get_org_stats when sub-pattern matches", () => {
    assert.deepEqual(
      deriveForcedPass1ToolArgs("get_org_stats", "how many active members"),
      { scope: "members" },
    );
  });

  it("returns undefined for get_org_stats when scope is generic", () => {
    assert.equal(
      deriveForcedPass1ToolArgs("get_org_stats", "give me the snapshot"),
      undefined,
    );
  });

  it("returns dimension for get_donation_analytics when sub-pattern matches", () => {
    assert.deepEqual(
      deriveForcedPass1ToolArgs("get_donation_analytics", "show donation trends by month"),
      { dimension: "trend" },
    );
  });

  it("returns query for search_org_content", () => {
    assert.deepEqual(
      deriveForcedPass1ToolArgs("search_org_content", "search announcements about team dinner"),
      { query: "team dinner" },
    );
  });

  it("returns query for find_navigation_targets", () => {
    assert.deepEqual(
      deriveForcedPass1ToolArgs("find_navigation_targets", "open announcements"),
      { query: "announcements" },
    );
  });

  it("returns undefined for get_donation_analytics when dimension is generic", () => {
    assert.equal(
      deriveForcedPass1ToolArgs("get_donation_analytics", "donation analytics"),
      undefined,
    );
  });

  it("returns undefined for unrelated tools", () => {
    assert.equal(
      deriveForcedPass1ToolArgs("list_members", "how many active members"),
      undefined,
    );
    assert.equal(
      deriveForcedPass1ToolArgs("prepare_event", "create an event for Friday"),
      undefined,
    );
  });
});

describe("search and navigation derivation helpers", () => {
  it("detects content search phrasing", () => {
    assert.match("search announcements about gala", CONTENT_SEARCH_PROMPT_PATTERN);
  });

  it("derives stripped content search queries", () => {
    assert.equal(
      deriveSearchOrgContentQuery("search announcements about team dinner"),
      "team dinner",
    );
  });

  it("derives stripped navigation queries", () => {
    assert.equal(
      deriveNavigationQuery("where is navigation settings?"),
      "navigation settings",
    );
  });
});
