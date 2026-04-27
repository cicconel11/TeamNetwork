import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getPass1Tools,
  getForcedPass1ToolChoice,
  isToolFirstEligible,
} from "../../../src/app/api/ai/[orgId]/chat/handler/pass1-tools";
import type { ChatAttachment } from "../../../src/app/api/ai/[orgId]/chat/handler/shared";
import type { CacheSurface } from "../../../src/lib/ai/semantic-cache-utils";
import type { TurnExecutionPolicy } from "../../../src/lib/ai/turn-execution-policy";
import type { EnterpriseRole } from "../../../src/types/enterprise";

type ToolPolicy = TurnExecutionPolicy["toolPolicy"];
type IntentType = TurnExecutionPolicy["intentType"];

interface RoutingCase {
  name: string;
  message: string;
  surface: CacheSurface;
  intentType?: IntentType;
  attachment?: ChatAttachment;
  currentPath?: string;
  enterpriseEnabled?: boolean;
  enterpriseRole?: EnterpriseRole;
  // Tool that MUST appear in pass-1 list (the model's correct pick).
  expectIncludes: string[];
  // Tools that must NOT appear (regression guards).
  expectExcludes?: string[];
  // If set, route must be a single-tool list = [tool] AND a forced
  // tool-choice is emitted (tool must be in FORCED_PASS1_TOOL_CHOICE_ELIGIBLE).
  expectForcedSingle?: string;
  // If set, route must be a single-tool list = [tool] but no forced
  // tool-choice (e.g. suggest_connections, suggest_mentors — single-tool
  // pattern overrides not in the forced-choice allowlist).
  expectSingleNoForce?: string;
  // If set, list must START with this tool (per-surface bias preserved).
  expectFirst?: string;
}

function namesOf(tools: ReturnType<typeof getPass1Tools>): string[] {
  return (tools ?? []).map((t) => t.function.name);
}

function runCase(c: RoutingCase) {
  const tools = getPass1Tools(
    c.message,
    c.surface,
    "surface_read_tools" satisfies ToolPolicy,
    (c.intentType ?? "knowledge_query") satisfies IntentType,
    c.attachment,
    c.currentPath,
    c.enterpriseEnabled ?? false,
    c.enterpriseRole,
  );
  const names = namesOf(tools);

  if (c.expectForcedSingle) {
    assert.deepEqual(
      names,
      [c.expectForcedSingle],
      `[${c.name}] expected single forced tool [${c.expectForcedSingle}], got [${names.join(", ")}]`,
    );
    const forced = getForcedPass1ToolChoice(tools);
    assert.ok(forced != null, `[${c.name}] forced tool choice expected, got undefined`);
  } else if (c.expectSingleNoForce) {
    assert.deepEqual(
      names,
      [c.expectSingleNoForce],
      `[${c.name}] expected single tool [${c.expectSingleNoForce}], got [${names.join(", ")}]`,
    );
  } else {
    for (const required of c.expectIncludes) {
      assert.ok(
        names.includes(required),
        `[${c.name}] expected list to include ${required}, got [${names.join(", ")}]`,
      );
    }
    for (const forbidden of c.expectExcludes ?? []) {
      assert.ok(
        !names.includes(forbidden),
        `[${c.name}] expected list to exclude ${forbidden}, got [${names.join(", ")}]`,
      );
    }
    if (c.expectFirst) {
      assert.equal(
        names[0],
        c.expectFirst,
        `[${c.name}] expected list[0]=${c.expectFirst} for surface bias, got ${names[0]}`,
      );
    }
  }
}

// People-search prompts: must hit list_members / list_alumni / list_parents
// pathway on ANY surface (regression for the calendar bug).
const PEOPLE_SEARCH_CASES: RoutingCase[] = (
  ["general", "members", "events", "analytics"] as CacheSurface[]
).flatMap((surface) => [
  {
    name: `${surface}: 'find anything about Louis Ciccone'`,
    message: "Find anything about Louis Ciccone",
    surface,
    intentType: "live_lookup",
    expectIncludes: ["list_members", "list_alumni", "list_parents", "search_org_content"],
  },
  {
    name: `${surface}: 'find anything about Juan Leonard' (nonexistent)`,
    message: "Find anything about Juan Leonard",
    surface,
    intentType: "live_lookup",
    expectIncludes: ["list_members", "list_alumni", "list_parents", "search_org_content"],
  },
]);

// Content-search prompts: must include search_org_content on every surface.
// Regression: 'find posts mentioning fundraising' on analytics used to hit
// get_org_stats. 'search announcements for team meeting' on calendar used to
// hit list_events.
const CONTENT_SEARCH_CASES: RoutingCase[] = (
  ["general", "members", "events", "analytics"] as CacheSurface[]
).flatMap((surface) => [
  {
    name: `${surface}: 'search announcements for team meeting'`,
    message: "search announcements for team meeting",
    surface,
    intentType: "live_lookup",
    expectIncludes: ["search_org_content"],
  },
  {
    name: `${surface}: 'find posts mentioning fundraising'`,
    message: "find posts mentioning fundraising",
    surface,
    intentType: "live_lookup",
    expectIncludes: ["search_org_content"],
  },
]);

// Navigation prompts: should reach find_navigation_targets when the model
// picks it. Required to be in the candidate list on every surface.
const NAVIGATION_CASES: RoutingCase[] = (
  ["general", "members", "events", "analytics"] as CacheSurface[]
).map((surface) => ({
  name: `${surface}: 'find the page for managing members' (knowledge intent)`,
  message: "find the page for managing members",
  surface,
  intentType: "knowledge_query",
  expectIncludes: ["find_navigation_targets"],
}));

// Per-surface BIAS: ambiguous prompts should still lead with the surface's
// primary tool so we don't regress the calendar UX.
const SURFACE_BIAS_CASES: RoutingCase[] = [
  {
    name: "events surface: ambiguous 'what is happening' still leads with list_events",
    message: "what is happening",
    surface: "events",
    intentType: "knowledge_query",
    expectFirst: "list_events",
    expectIncludes: ["list_events", "search_org_content", "list_members"],
  },
  {
    name: "events surface: 'whats on the calendar this week' still leads with list_events",
    message: "what's on the calendar this week",
    surface: "events",
    intentType: "knowledge_query",
    expectFirst: "list_events",
    expectIncludes: ["list_events"],
  },
  {
    name: "analytics surface: ambiguous 'show me the snapshot' still leads with get_org_stats",
    message: "show me the snapshot",
    surface: "analytics",
    intentType: "knowledge_query",
    expectFirst: "get_org_stats",
    expectIncludes: ["get_org_stats", "search_org_content"],
  },
  {
    name: "members surface: 'what is going on around here' leads with list_members",
    message: "what is going on around here",
    surface: "members",
    intentType: "knowledge_query",
    expectFirst: "list_members",
    expectIncludes: ["list_members", "search_org_content"],
  },
];

// FORCED single-tool overrides — must still be single-tool on the relevant
// surface (especially events surface, which used to be locked entirely).
const FORCED_SINGLE_CASES: RoutingCase[] = [
  {
    name: "events surface: 'schedule a meeting tomorrow at 3pm' → prepare_event",
    message: "schedule a meeting tomorrow at 3pm",
    surface: "events",
    intentType: "action_request",
    expectIncludes: [],
    expectForcedSingle: "prepare_event",
  },
  {
    name: "general surface: 'create an announcement' → prepare_announcement",
    message: "create an announcement about the team picnic",
    surface: "general",
    intentType: "action_request",
    expectIncludes: [],
    expectForcedSingle: "prepare_announcement",
  },
  {
    name: "general surface: 'post a job opening' → prepare_job_posting",
    message: "post a new job opening for an assistant coach",
    surface: "general",
    intentType: "action_request",
    expectIncludes: [],
    expectForcedSingle: "prepare_job_posting",
  },
  {
    name: "general surface: 'list my chat groups' → list_chat_groups",
    message: "list my chat groups",
    surface: "general",
    intentType: "knowledge_query",
    expectIncludes: [],
    expectForcedSingle: "list_chat_groups",
  },
];

// DOMAIN-shaped prompts that have specific routing patterns that must STILL
// fire (regression: globals merge must not clobber existing patterns).
const DOMAIN_PATTERN_CASES: RoutingCase[] = [
  {
    name: "general: alumni roster prompt → list_alumni",
    message: "show me alumni from the class of 2010",
    surface: "general",
    intentType: "knowledge_query",
    expectIncludes: [],
    expectForcedSingle: "list_alumni",
  },
  {
    name: "general: parent directory → list_parents",
    message: "show me the parent directory",
    surface: "general",
    intentType: "knowledge_query",
    expectIncludes: [],
    expectForcedSingle: "list_parents",
  },
  {
    name: "general: philanthropy events → list_philanthropy_events",
    message: "list the philanthropy events",
    surface: "general",
    intentType: "knowledge_query",
    expectIncludes: [],
    expectForcedSingle: "list_philanthropy_events",
  },
  {
    name: "general: donation analytics → get_donation_analytics",
    message: "show donation trends by month",
    surface: "general",
    intentType: "knowledge_query",
    expectIncludes: [],
    expectForcedSingle: "get_donation_analytics",
  },
  {
    name: "general: donation list → list_donations",
    message: "list the donors",
    surface: "general",
    intentType: "knowledge_query",
    expectIncludes: [],
    expectForcedSingle: "list_donations",
  },
];

// MENTOR + CONNECTION prompts: only force single-tool on members surface.
// On other surfaces they should fall through to the merged list.
const MENTOR_CONNECTION_CASES: RoutingCase[] = [
  {
    name: "members: 'find a mentor for me' → suggest_mentors",
    message: "find a mentor for me",
    surface: "members",
    intentType: "knowledge_query",
    expectIncludes: [],
    expectSingleNoForce: "suggest_mentors",
  },
  {
    name: "members: 'which mentors are accepting new mentees' → list_available_mentors",
    message: "which mentors are accepting new mentees",
    surface: "members",
    intentType: "knowledge_query",
    expectIncludes: [],
    expectSingleNoForce: "list_available_mentors",
  },
  {
    name: "members: 'suggest connections for networking' → suggest_connections",
    message: "suggest some connections for networking",
    surface: "members",
    intentType: "knowledge_query",
    expectIncludes: [],
    expectSingleNoForce: "suggest_connections",
  },
];

const ENTERPRISE_PORTAL_CASES: RoutingCase[] = [
  {
    name: "enterprise portal: billing path → get_enterprise_quota",
    message: "show enterprise billing quota",
    surface: "analytics",
    currentPath: "/enterprise/acme-ent/billing",
    enterpriseEnabled: true,
    enterpriseRole: "owner",
    expectIncludes: [],
    expectForcedSingle: "get_enterprise_quota",
  },
  {
    name: "enterprise portal: org capacity prompt → get_enterprise_org_capacity",
    message: "how many free managed org slots remain",
    surface: "analytics",
    currentPath: "/enterprise/acme-ent",
    enterpriseEnabled: true,
    enterpriseRole: "org_admin",
    expectIncludes: [],
    expectForcedSingle: "get_enterprise_org_capacity",
  },
  {
    name: "enterprise portal: organizations path → list_managed_orgs",
    message: "show me organizations",
    surface: "general",
    currentPath: "/enterprise/acme-ent/organizations",
    enterpriseEnabled: true,
    enterpriseRole: "owner",
    expectIncludes: [],
    expectForcedSingle: "list_managed_orgs",
  },
];

const ATTACHMENT_ROUTING_CASES: RoutingCase[] = [
  {
    name: "attachment: PDF schedule upload → extract_schedule_pdf",
    message: "here is the schedule",
    surface: "events",
    intentType: "action_request",
    attachment: {
      storagePath: "orgs/org-1/uploads/schedule.pdf",
      fileName: "schedule.pdf",
      mimeType: "application/pdf",
    },
    expectIncludes: [],
    expectForcedSingle: "extract_schedule_pdf",
  },
  {
    name: "attachment: PNG schedule upload → extract_schedule_pdf",
    message: "import this schedule",
    surface: "events",
    intentType: "action_request",
    attachment: {
      storagePath: "orgs/org-1/uploads/schedule.png",
      fileName: "schedule.png",
      mimeType: "image/png",
    },
    expectIncludes: [],
    expectForcedSingle: "extract_schedule_pdf",
  },
];

const MEMBER_DISAMBIGUATION_CASES: RoutingCase[] = [
  {
    name: "members surface: member count prompt → get_org_stats",
    message: "how many active members do we have",
    surface: "members",
    expectIncludes: [],
    expectForcedSingle: "get_org_stats",
  },
  {
    name: "members surface: member roster prompt → list_members",
    message: "who are the recent members",
    surface: "members",
    expectIncludes: [],
    expectForcedSingle: "list_members",
  },
];

describe("surface-routing battery — people search reaches every surface", () => {
  for (const c of PEOPLE_SEARCH_CASES) {
    it(c.name, () => runCase(c));
  }
});

describe("surface-routing battery — content search reaches every surface", () => {
  for (const c of CONTENT_SEARCH_CASES) {
    it(c.name, () => runCase(c));
  }
});

describe("surface-routing battery — navigation reachable from every surface", () => {
  for (const c of NAVIGATION_CASES) {
    it(c.name, () => runCase(c));
  }
});

describe("surface-routing battery — per-surface bias preserved for ambiguous prompts", () => {
  for (const c of SURFACE_BIAS_CASES) {
    it(c.name, () => runCase(c));
  }
});

describe("surface-routing battery — forced single-tool overrides untouched by merge", () => {
  for (const c of FORCED_SINGLE_CASES) {
    it(c.name, () => runCase(c));
  }
});

describe("surface-routing battery — domain pattern routing untouched by merge", () => {
  for (const c of DOMAIN_PATTERN_CASES) {
    it(c.name, () => runCase(c));
  }
});

describe("surface-routing battery — mentor/connection routing on members surface", () => {
  for (const c of MENTOR_CONNECTION_CASES) {
    it(c.name, () => runCase(c));
  }
});

describe("surface-routing battery — enterprise portal routing", () => {
  for (const c of ENTERPRISE_PORTAL_CASES) {
    it(c.name, () => runCase(c));
  }
});

describe("surface-routing battery — attachment-driven routing", () => {
  for (const c of ATTACHMENT_ROUTING_CASES) {
    it(c.name, () => runCase(c));
  }
});

describe("surface-routing battery — member count vs roster disambiguation", () => {
  for (const c of MEMBER_DISAMBIGUATION_CASES) {
    it(c.name, () => runCase(c));
  }
});

describe("surface-routing battery — tool-first eligibility for routed singletons", () => {
  it("merged events default skips the calendar fast-path", () => {
    const tools = getPass1Tools(
      "show me upcoming events",
      "events",
      "surface_read_tools",
      "knowledge_query",
    );
    // Multi-tool now (events + globals), so isToolFirstEligible should be false.
    assert.equal(
      isToolFirstEligible(tools),
      false,
      "merged list is multi-tool — tool-first fast-path should be skipped",
    );
  });

  it("forced single-tool prepare_event is NOT tool-first eligible (write prep)", () => {
    const tools = getPass1Tools(
      "schedule a meeting tomorrow",
      "events",
      "surface_read_tools",
      "action_request",
    );
    assert.deepEqual(namesOf(tools), ["prepare_event"]);
    assert.equal(
      isToolFirstEligible(tools),
      false,
      "prepare_event is a write-prep tool, not a tool-first read",
    );
  });
});
