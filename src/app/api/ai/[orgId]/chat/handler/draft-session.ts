import type {
  DraftSessionRecord,
  DraftSessionType,
} from "@/lib/ai/draft-sessions";
import type { ToolName } from "@/lib/ai/tools/definitions";
import { resolveSurfaceRouting } from "@/lib/ai/intent-router";
import { getNonEmptyString } from "./formatters/index";
import {
  CREATE_ANNOUNCEMENT_PROMPT_PATTERN,
  CREATE_DISCUSSION_PROMPT_PATTERN,
  CREATE_EVENT_PROMPT_PATTERN,
  CREATE_JOB_PROMPT_PATTERN,
  DIRECT_QUERY_START_PATTERN,
  DISCUSSION_REPLY_PROMPT_PATTERN,
  EXPLICIT_EVENT_DRAFT_SWITCH_PATTERN,
  LIST_CHAT_GROUPS_PROMPT_PATTERN,
  SEND_CHAT_MESSAGE_PROMPT_PATTERN,
  SEND_GROUP_CHAT_MESSAGE_PROMPT_PATTERN,
  looksLikeStructuredJobDraft,
} from "./pass1-tools";

export const DRAFT_CANCEL_PATTERN =
  /(?<!\w)(?:cancel|never\s+mind|nevermind|forget\s+(?:that|it)|scratch\s+that|stop\s+working\s+on\s+that)(?!\w)/i;

export function getToolNameForDraftType(draftType: DraftSessionType): ToolName {
  switch (draftType) {
    case "create_announcement":
      return "prepare_announcement";
    case "create_job_posting":
      return "prepare_job_posting";
    case "send_chat_message":
      return "prepare_chat_message";
    case "send_group_chat_message":
      return "prepare_group_message";
    case "create_discussion_reply":
      return "prepare_discussion_reply";
    case "create_discussion_thread":
      return "prepare_discussion_thread";
    case "create_event":
      return "prepare_event";
  }
}

export function mergeDraftPayload(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  const normalizedOverrides = Object.fromEntries(
    Object.entries(overrides).filter(
      ([, value]) => !(typeof value === "string" && value.trim().length === 0)
    )
  );

  return {
    ...base,
    ...normalizedOverrides,
  };
}

export type DraftHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const DISCUSSION_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you create a discussion thread|i can draft this discussion|i drafted the discussion thread)/i;
const ANNOUNCEMENT_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you create an announcement|i can draft this announcement|i drafted the announcement)/i;
const DISCUSSION_REPLY_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you draft a reply|i can draft this reply|i drafted the discussion reply)/i;
const JOB_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you create a job posting|i can draft this job|i drafted the job posting)/i;
const CHAT_MESSAGE_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you draft a chat message|i can draft that chat message|i drafted the chat message)/i;
const GROUP_CHAT_MESSAGE_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you draft a group message|i can draft that group message|i drafted the group message)/i;
const EVENT_DRAFT_ASSISTANT_PATTERN =
  /(?:happy to help you create an event|i can draft this event|i drafted the event)/i;

export function extractStructuredFieldMap(message: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let currentLabel: string | null = null;
  let currentValue: string[] = [];

  const flush = () => {
    if (!currentLabel) {
      return;
    }
    const value = currentValue.join(" ").trim();
    if (value.length > 0) {
      entries[currentLabel] = value;
    }
    currentLabel = null;
    currentValue = [];
  };

  for (const line of lines) {
    const match = line.match(/^([a-z][a-z\s]+?)\s*:\s*(.+)$/i);
    if (match) {
      flush();
      currentLabel = match[1].trim().toLowerCase().replace(/\s+/g, " ");
      currentValue = [match[2].trim()];
      continue;
    }

    if (currentLabel) {
      currentValue.push(line);
    }
  }

  flush();
  return entries;
}

export function normalizeLocationType(value: string | undefined): "remote" | "hybrid" | "onsite" | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "remote" || normalized === "hybrid" || normalized === "onsite") {
    return normalized;
  }

  return undefined;
}

export function normalizeExperienceLevel(
  value: string | undefined
): "entry" | "mid" | "senior" | "lead" | "executive" | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "entry" || normalized === "mid" || normalized === "senior" || normalized === "lead" || normalized === "executive") {
    return normalized;
  }

  if (normalized === "junior" || normalized === "new grad" || normalized === "new graduate") {
    return "entry";
  }

  return undefined;
}

export function normalizeEventType(
  value: string | undefined
): "general" | "philanthropy" | "game" | "practice" | "meeting" | "social" | "workout" | "fundraiser" | "class" | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "general" ||
    normalized === "philanthropy" ||
    normalized === "game" ||
    normalized === "practice" ||
    normalized === "meeting" ||
    normalized === "social" ||
    normalized === "workout" ||
    normalized === "fundraiser" ||
    normalized === "class"
  ) {
    return normalized;
  }

  return undefined;
}

export function normalizeBooleanFlag(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "n", "0"].includes(normalized)) {
    return false;
  }

  return undefined;
}

export function extractAnnouncementDraftFromHistory(messages: DraftHistoryMessage[]): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const fields = extractStructuredFieldMap(message.content);
    const title = getNonEmptyString(fields.title);
    const body = getNonEmptyString(fields.body);
    const audience = getNonEmptyString(fields.audience);
    const isPinned = normalizeBooleanFlag(
      getNonEmptyString(fields["pin it"] ?? fields["is pinned"] ?? fields.pinned ?? fields.pin) ?? undefined
    );
    const sendNotification = normalizeBooleanFlag(
      getNonEmptyString(
        fields["send notification"] ??
          fields.notification ??
          fields.notify ??
          fields.email
      ) ?? undefined
    );

    if (title) draft.title = title;
    if (body) draft.body = body;
    if (
      audience === "all" ||
      audience === "members" ||
      audience === "active_members" ||
      audience === "alumni" ||
      audience === "parents" ||
      audience === "individuals"
    ) {
      draft.audience = audience;
    }
    if (typeof isPinned === "boolean") draft.is_pinned = isPinned;
    if (typeof sendNotification === "boolean") draft.send_notification = sendNotification;
  }

  return draft;
}

export function extractDiscussionDraftFromHistory(messages: DraftHistoryMessage[]): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const fields = extractStructuredFieldMap(message.content);
    const title = getNonEmptyString(fields.title);
    const body = getNonEmptyString(fields.body);

    if (title) {
      draft.title = title;
    }
    if (body) {
      draft.body = body;
    }
  }

  return draft;
}

export function extractDiscussionReplyDraftFromHistory(
  messages: DraftHistoryMessage[]
): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const fields = extractStructuredFieldMap(message.content);
    const discussionThreadId = getNonEmptyString(
      fields.discussion_thread_id ?? fields["discussion thread id"] ?? fields["thread id"]
    );
    const threadTitle = getNonEmptyString(fields.thread_title ?? fields["thread title"]);
    const body = getNonEmptyString(fields.body);

    if (discussionThreadId) {
      draft.discussion_thread_id = discussionThreadId;
    }
    if (threadTitle) {
      draft.thread_title = threadTitle;
    }
    if (body) {
      draft.body = body;
      continue;
    }

    const trimmed = message.content.trim();
    if (
      trimmed.length > 0 &&
      !trimmed.endsWith("?") &&
      !DISCUSSION_REPLY_PROMPT_PATTERN.test(trimmed) &&
      !CREATE_DISCUSSION_PROMPT_PATTERN.test(trimmed)
    ) {
      draft.body = trimmed;
    }
  }

  return draft;
}

export function extractEventDraftFromHistory(messages: DraftHistoryMessage[]): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const fields = extractStructuredFieldMap(message.content);
    const title = getNonEmptyString(fields.title);
    const description = getNonEmptyString(fields.description);
    const startDate = getNonEmptyString(fields["start date"]);
    const startTime = getNonEmptyString(fields["start time"]);
    const endDate = getNonEmptyString(fields["end date"]);
    const endTime = getNonEmptyString(fields["end time"]);
    const location = getNonEmptyString(fields.location);
    const eventType = normalizeEventType(getNonEmptyString(fields["event type"]) ?? undefined);
    const isPhilanthropy = normalizeBooleanFlag(
      getNonEmptyString(fields["is philanthropy"] ?? fields.philanthropy) ?? undefined
    );

    if (title) draft.title = title;
    if (description) draft.description = description;
    if (startDate) draft.start_date = startDate;
    if (startTime) draft.start_time = startTime;
    if (endDate) draft.end_date = endDate;
    if (endTime) draft.end_time = endTime;
    if (location) draft.location = location;
    if (eventType) draft.event_type = eventType;
    if (typeof isPhilanthropy === "boolean") draft.is_philanthropy = isPhilanthropy;
  }

  return draft;
}

export function extractJobDraftFromHistory(messages: DraftHistoryMessage[]): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const fields = extractStructuredFieldMap(message.content);
    const title = getNonEmptyString(fields.title);
    const company = getNonEmptyString(fields.company);
    const location = getNonEmptyString(fields.location);
    const description = getNonEmptyString(fields.description);
    const applicationUrl = getNonEmptyString(fields["application url"] ?? fields["application link"] ?? fields.link);
    const contactEmail = getNonEmptyString(fields["contact email"]);
    const industry = getNonEmptyString(fields.industry);
    const locationType = normalizeLocationType(getNonEmptyString(fields["location type"]) ?? undefined);
    const experienceLevel = normalizeExperienceLevel(getNonEmptyString(fields["experience level"]) ?? undefined);

    if (title) draft.title = title;
    if (company) draft.company = company;
    if (location) draft.location = location;
    if (description) draft.description = description;
    if (applicationUrl) draft.application_url = applicationUrl;
    if (contactEmail) draft.contact_email = contactEmail;
    if (industry) draft.industry = industry;
    if (locationType) draft.location_type = locationType;
    if (experienceLevel) draft.experience_level = experienceLevel;
  }

  return draft;
}

export function extractChatMessageDraftFromHistory(messages: DraftHistoryMessage[]): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const fields = extractStructuredFieldMap(message.content);
    const recipientMemberId = getNonEmptyString(
      fields.recipient_member_id ?? fields["recipient member id"] ?? fields["member id"]
    );
    const personQuery = getNonEmptyString(
      fields.person_query ?? fields.recipient ?? fields.to ?? fields.member
    );
    const body = getNonEmptyString(fields.body ?? fields.message);

    if (recipientMemberId) {
      draft.recipient_member_id = recipientMemberId;
    }
    if (personQuery) {
      draft.person_query = personQuery;
    }
    if (body) {
      draft.body = body;
      continue;
    }

    const trimmed = message.content.trim();
    if (
      trimmed.length > 0 &&
      !trimmed.endsWith("?") &&
      !SEND_CHAT_MESSAGE_PROMPT_PATTERN.test(trimmed) &&
      !CREATE_DISCUSSION_PROMPT_PATTERN.test(trimmed) &&
      !DISCUSSION_REPLY_PROMPT_PATTERN.test(trimmed)
    ) {
      draft.body = trimmed;
    }
  }

  return draft;
}

export function extractGroupMessageDraftFromHistory(messages: DraftHistoryMessage[]): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const fields = extractStructuredFieldMap(message.content);
    const chatGroupId = getNonEmptyString(
      fields.chat_group_id ?? fields["chat group id"] ?? fields["group id"]
    );
    const groupNameQuery = getNonEmptyString(
      fields.group_name_query ?? fields.group ?? fields.channel ?? fields["chat group"]
    );
    const body = getNonEmptyString(fields.body ?? fields.message);

    if (chatGroupId) {
      draft.chat_group_id = chatGroupId;
    }
    if (groupNameQuery) {
      draft.group_name_query = groupNameQuery;
    }
    if (body) {
      draft.body = body;
      continue;
    }

    const trimmed = message.content.trim();
    if (
      trimmed.length > 0 &&
      !trimmed.endsWith("?") &&
      !SEND_GROUP_CHAT_MESSAGE_PROMPT_PATTERN.test(trimmed) &&
      !LIST_CHAT_GROUPS_PROMPT_PATTERN.test(trimmed) &&
      !CREATE_DISCUSSION_PROMPT_PATTERN.test(trimmed) &&
      !DISCUSSION_REPLY_PROMPT_PATTERN.test(trimmed)
    ) {
      draft.body = trimmed;
    }
  }

  return draft;
}

export function inferDraftTypeFromMessage(message: DraftHistoryMessage): DraftSessionType | null {
  if (message.role === "user") {
    if (CREATE_ANNOUNCEMENT_PROMPT_PATTERN.test(message.content)) {
      return "create_announcement";
    }
    if (SEND_GROUP_CHAT_MESSAGE_PROMPT_PATTERN.test(message.content)) {
      return "send_group_chat_message";
    }
    if (SEND_CHAT_MESSAGE_PROMPT_PATTERN.test(message.content)) {
      return "send_chat_message";
    }
    if (DISCUSSION_REPLY_PROMPT_PATTERN.test(message.content)) {
      return "create_discussion_reply";
    }
    if (CREATE_JOB_PROMPT_PATTERN.test(message.content) || looksLikeStructuredJobDraft(message.content)) {
      return "create_job_posting";
    }
    if (CREATE_DISCUSSION_PROMPT_PATTERN.test(message.content)) {
      return "create_discussion_thread";
    }
    if (CREATE_EVENT_PROMPT_PATTERN.test(message.content)) {
      return "create_event";
    }
    return null;
  }

  if (ANNOUNCEMENT_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "create_announcement";
  }
  if (JOB_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "create_job_posting";
  }
  if (CHAT_MESSAGE_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "send_chat_message";
  }
  if (GROUP_CHAT_MESSAGE_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "send_group_chat_message";
  }
  if (DISCUSSION_REPLY_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "create_discussion_reply";
  }
  if (DISCUSSION_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "create_discussion_thread";
  }
  if (EVENT_DRAFT_ASSISTANT_PATTERN.test(message.content)) {
    return "create_event";
  }
  return null;
}

export function inferDraftSessionFromHistory(input: {
  organizationId: string;
  userId: string;
  threadId: string;
  messages: DraftHistoryMessage[];
}): DraftSessionRecord | null {
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const draftType = inferDraftTypeFromMessage(input.messages[index]);
    if (!draftType) {
      continue;
    }

    const relevantMessages = input.messages.slice(index);
    let draftPayload: Record<string, unknown>;
    let missingFields: string[];

    switch (draftType) {
      case "create_announcement":
        draftPayload = extractAnnouncementDraftFromHistory(relevantMessages);
        missingFields = (["title"] as const).filter(
          (field) => getNonEmptyString(draftPayload[field]) == null
        );
        break;
      case "send_chat_message":
        draftPayload = extractChatMessageDraftFromHistory(relevantMessages);
        missingFields = [
          ...(["body"] as const).filter((field) => getNonEmptyString(draftPayload[field]) == null),
          ...(
            getNonEmptyString(draftPayload.recipient_member_id) == null &&
            getNonEmptyString(draftPayload.person_query) == null
              ? ["person_query"]
              : []
          ),
        ];
        break;
      case "send_group_chat_message":
        draftPayload = extractGroupMessageDraftFromHistory(relevantMessages);
        missingFields = [
          ...(["body"] as const).filter((field) => getNonEmptyString(draftPayload[field]) == null),
          ...(
            getNonEmptyString(draftPayload.chat_group_id) == null &&
            getNonEmptyString(draftPayload.group_name_query) == null
              ? ["group_name_query"]
              : []
          ),
        ];
        break;
      case "create_discussion_reply":
        draftPayload = extractDiscussionReplyDraftFromHistory(relevantMessages);
        missingFields = (["body"] as const).filter(
          (field) => getNonEmptyString(draftPayload[field]) == null
        );
        break;
      case "create_job_posting":
        draftPayload = extractJobDraftFromHistory(relevantMessages);
        missingFields = [
          ...(["title", "company", "location", "industry", "experience_level", "description"] as const)
            .filter((field) => getNonEmptyString(draftPayload[field]) == null),
          ...(
            getNonEmptyString(draftPayload.application_url) == null &&
            getNonEmptyString(draftPayload.contact_email) == null
              ? ["application_url"]
              : []
          ),
        ];
        break;
      case "create_discussion_thread":
        draftPayload = extractDiscussionDraftFromHistory(relevantMessages);
        missingFields = (["title", "body"] as const).filter(
          (field) => getNonEmptyString(draftPayload[field]) == null
        );
        break;
      case "create_event":
        draftPayload = extractEventDraftFromHistory(relevantMessages);
        missingFields = (["title", "start_date", "start_time"] as const).filter(
          (field) => getNonEmptyString(draftPayload[field]) == null
        );
        break;
    }

    if (Object.keys(draftPayload).length === 0 && missingFields.length === 0) {
      continue;
    }

    const now = new Date().toISOString();
    return {
      id: `inferred-${input.threadId}`,
      organization_id: input.organizationId,
      user_id: input.userId,
      thread_id: input.threadId,
      draft_type: draftType,
      status: missingFields.length > 0 ? "collecting_fields" : "ready_for_confirmation",
      draft_payload: draftPayload as DraftSessionRecord["draft_payload"],
      missing_fields: missingFields,
      pending_action_id: null,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_at: now,
      updated_at: now,
    };
  }

  return null;
}

export function buildDraftSessionContextMessage(
  draftSession: DraftSessionRecord
): string | null {
  const lines = ["## Active Draft Session"];
  lines.push(`- Draft type: ${draftSession.draft_type.replace(/_/g, " ")}`);
  if (draftSession.missing_fields.length > 0) {
    lines.push(`- Missing fields: ${draftSession.missing_fields.join(", ")}`);
  }

  const payloadLines = Object.entries(draftSession.draft_payload ?? {})
    .map(([key, value]) => {
      if (typeof value === "string" && value.trim().length > 0) {
        return `- ${key}: ${value}`;
      }
      if (Array.isArray(value) && value.length > 0) {
        return `- ${key}: ${value.join(", ")}`;
      }
      return null;
    })
    .filter((line): line is string => Boolean(line));

  if (payloadLines.length > 0) {
    lines.push("- Current draft details:");
    lines.push(...payloadLines);
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

export function shouldContinueDraftSession(
  message: string,
  draftSession: DraftSessionRecord,
  routing: ReturnType<typeof resolveSurfaceRouting>
): boolean {
  const isAnnouncementPrompt = CREATE_ANNOUNCEMENT_PROMPT_PATTERN.test(message);
  const isJobPrompt = CREATE_JOB_PROMPT_PATTERN.test(message);
  const isChatMessagePrompt = SEND_CHAT_MESSAGE_PROMPT_PATTERN.test(message);
  const isDiscussionReplyPrompt = DISCUSSION_REPLY_PROMPT_PATTERN.test(message);
  const isDiscussionPrompt = CREATE_DISCUSSION_PROMPT_PATTERN.test(message);
  const isEventPrompt = EXPLICIT_EVENT_DRAFT_SWITCH_PATTERN.test(message);

  if (draftSession.draft_type === "create_announcement" && isAnnouncementPrompt) {
    return true;
  }

  if (draftSession.draft_type === "create_job_posting" && isJobPrompt) {
    return true;
  }

  if (draftSession.draft_type === "send_chat_message" && isChatMessagePrompt) {
    return true;
  }

  if (draftSession.draft_type === "create_discussion_reply" && isDiscussionReplyPrompt) {
    return true;
  }

  if (draftSession.draft_type === "create_discussion_thread" && isDiscussionPrompt) {
    return true;
  }

  if (draftSession.draft_type === "create_event" && isEventPrompt) {
    return true;
  }

  if (
    (draftSession.draft_type === "create_announcement" &&
      (isJobPrompt || isChatMessagePrompt || isDiscussionReplyPrompt || isDiscussionPrompt || isEventPrompt)) ||
    (draftSession.draft_type === "create_job_posting" &&
      (isAnnouncementPrompt || isChatMessagePrompt || isDiscussionReplyPrompt || isDiscussionPrompt || isEventPrompt)) ||
    (draftSession.draft_type === "send_chat_message" &&
      (isAnnouncementPrompt || isJobPrompt || isDiscussionReplyPrompt || isDiscussionPrompt || isEventPrompt)) ||
    (draftSession.draft_type === "create_discussion_reply" &&
      (isAnnouncementPrompt || isJobPrompt || isChatMessagePrompt || isDiscussionPrompt || isEventPrompt)) ||
    (draftSession.draft_type === "create_discussion_thread" &&
      (isAnnouncementPrompt || isJobPrompt || isChatMessagePrompt || isDiscussionReplyPrompt || isEventPrompt)) ||
    (draftSession.draft_type === "create_event" &&
      (isAnnouncementPrompt || isJobPrompt || isChatMessagePrompt || isDiscussionReplyPrompt || isDiscussionPrompt))
  ) {
    return false;
  }

  if (DRAFT_CANCEL_PATTERN.test(message)) {
    return false;
  }

  if (routing.intentType === "navigation" || routing.intentType === "casual") {
    return false;
  }

  const trimmed = message.trim();
  if (trimmed.endsWith("?") || DIRECT_QUERY_START_PATTERN.test(trimmed)) {
    return false;
  }

  return true;
}
