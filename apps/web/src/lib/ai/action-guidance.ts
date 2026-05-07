import type { OrgRole } from "@/lib/auth/role-utils";

export type GuidanceFeature =
  | "home"
  | "members"
  | "alumni"
  | "parents"
  | "events"
  | "calendar"
  | "announcements"
  | "jobs"
  | "discussions"
  | "messages"
  | "forms"
  | "philanthropy"
  | "donations"
  | "expenses"
  | "mentorship"
  | "media"
  | "competition"
  | "records"
  | "workouts"
  | "customization"
  | "settings"
  | "navigation"
  | "approvals"
  | "unknown";

export interface ActionGuidance {
  userCanAccess: boolean;
  manualSteps: string[];
  assistantCanHelpWith: string[];
}

const DEFAULT_GUIDANCE: ActionGuidance = {
  userCanAccess: true,
  manualSteps: ["Open the linked page and use the controls there."],
  assistantCanHelpWith: ["Find the right page and summarize related organization context."],
};

const GUIDANCE_BY_FEATURE: Record<GuidanceFeature, Omit<ActionGuidance, "userCanAccess">> = {
  home: {
    manualSteps: ["Open the dashboard to review the organization overview."],
    assistantCanHelpWith: ["Summarize recent organization activity and point you to the right feature area."],
  },
  members: {
    manualSteps: ["Open the members page to view, add, edit, or manage member records."],
    assistantCanHelpWith: ["List members, answer roster questions, suggest connections, and draft direct messages."],
  },
  alumni: {
    manualSteps: ["Open the alumni page to view, add, edit, import, or manage alumni records."],
    assistantCanHelpWith: ["List alumni, filter by profile details, and help with connection or mentorship questions."],
  },
  parents: {
    manualSteps: ["Open the parents page to view, add, or edit parent records."],
    assistantCanHelpWith: ["List parent records and help find the right family contact page."],
  },
  events: {
    manualSteps: ["Open the events page to review, edit, delete, or RSVP to events."],
    assistantCanHelpWith: ["List events, draft new events, and extract events from schedule files or websites."],
  },
  calendar: {
    manualSteps: ["Open the calendar page to review schedules, sources, sync settings, or event details."],
    assistantCanHelpWith: ["Find calendar pages, list events, and prepare event drafts from schedule details."],
  },
  announcements: {
    manualSteps: ["Open the announcements page to review, edit, pin, or delete announcements."],
    assistantCanHelpWith: ["List announcements, summarize recent updates, and draft new announcements for confirmation."],
  },
  jobs: {
    manualSteps: ["Open the jobs page to review, edit, close, or delete job postings."],
    assistantCanHelpWith: ["List job postings and prepare a new job posting draft for confirmation."],
  },
  discussions: {
    manualSteps: ["Open the discussions page to read, moderate, lock, or manage discussion threads."],
    assistantCanHelpWith: ["List discussions, draft new threads, and prepare replies for confirmation."],
  },
  messages: {
    manualSteps: ["Open messages to read conversations, manage groups, or moderate chat activity."],
    assistantCanHelpWith: ["List chat groups and prepare direct or group messages for confirmation."],
  },
  forms: {
    manualSteps: ["Open forms to create, edit, publish, or review submissions."],
    assistantCanHelpWith: ["Find the correct forms page and explain where to create or manage forms."],
  },
  philanthropy: {
    manualSteps: ["Open philanthropy to manage events, fundraising links, or volunteer activity."],
    assistantCanHelpWith: ["List philanthropy events and summarize donation or fundraising activity."],
  },
  donations: {
    manualSteps: ["Open donations to review donor records, record gifts, or manage donation workflows."],
    assistantCanHelpWith: ["Summarize donation trends, list donations, and break down giving by purpose."],
  },
  expenses: {
    manualSteps: ["Open expenses to add, review, or manage expense records."],
    assistantCanHelpWith: ["Find finance pages and summarize available donation or philanthropy context."],
  },
  mentorship: {
    manualSteps: ["Open mentorship to review profiles, matches, tasks, or program activity."],
    assistantCanHelpWith: ["Suggest mentors and explain matching signals from available profile data."],
  },
  media: {
    manualSteps: ["Open media to upload, organize, approve, or manage albums and files."],
    assistantCanHelpWith: ["Find the media page and explain where to manage uploads or albums."],
  },
  competition: {
    manualSteps: ["Open competition to manage teams, points, and competition setup."],
    assistantCanHelpWith: ["Find the competition pages and explain where to add teams or points."],
  },
  records: {
    manualSteps: ["Open records to create, review, or manage record entries."],
    assistantCanHelpWith: ["Find the records page and explain where to add or review records."],
  },
  workouts: {
    manualSteps: ["Open workouts to create, review, or manage workout entries."],
    assistantCanHelpWith: ["Find the workouts page and explain where to add or review workouts."],
  },
  customization: {
    manualSteps: ["Open customization to change branding and appearance settings."],
    assistantCanHelpWith: ["Find customization pages and explain which settings live there."],
  },
  settings: {
    manualSteps: ["Open settings to manage invites, approvals, subscriptions, integrations, or organization access preferences."],
    assistantCanHelpWith: ["Find the right settings page and explain the manual steps to take there."],
  },
  navigation: {
    manualSteps: ["Open navigation settings to customize sidebar labels, visibility, and ordering."],
    assistantCanHelpWith: ["Find navigation settings and explain which navigation controls are available."],
  },
  approvals: {
    manualSteps: ["Open approvals to review and act on pending moderation items."],
    assistantCanHelpWith: ["Find the approvals page and explain what can be reviewed there."],
  },
  unknown: DEFAULT_GUIDANCE,
};

export function featureFromHref(href: string): GuidanceFeature {
  const segments = href.split("/").filter(Boolean);
  const feature = segments[1] ?? "";

  if (feature === "") return "home";
  if (feature === "settings") {
    const settingsFeature = segments[2] ?? "";
    if (settingsFeature === "navigation") return "navigation";
    if (settingsFeature === "approvals") return "approvals";
    return "settings";
  }

  if (feature === "calendar") return "calendar";
  if (feature === "events") return "events";
  if (feature === "chat") return "messages";
  if (feature === "discussions") return "discussions";

  return (
    [
      "members",
      "alumni",
      "parents",
      "announcements",
      "jobs",
      "messages",
      "forms",
      "philanthropy",
      "donations",
      "expenses",
      "mentorship",
      "media",
      "competition",
      "records",
      "workouts",
      "customization",
    ] as GuidanceFeature[]
  ).includes(feature as GuidanceFeature)
    ? (feature as GuidanceFeature)
    : "unknown";
}

export function getActionGuidance(input: {
  href: string;
  kind?: "page" | "create";
  role?: OrgRole | null;
}): ActionGuidance {
  const feature = featureFromHref(input.href);
  const guidance = GUIDANCE_BY_FEATURE[feature] ?? DEFAULT_GUIDANCE;
  const createStep =
    input.kind === "create"
      ? "Use the create form on that page to review details before saving."
      : null;

  return {
    userCanAccess: true,
    manualSteps: createStep ? [createStep, ...guidance.manualSteps] : guidance.manualSteps,
    assistantCanHelpWith: guidance.assistantCanHelpWith,
  };
}
