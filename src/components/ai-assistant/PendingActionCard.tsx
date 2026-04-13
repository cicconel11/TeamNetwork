"use client";

import type { PendingActionState } from "./panel-state";

interface PendingActionCardProps {
  action: PendingActionState;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => Promise<void> | void;
  onCancel: () => Promise<void> | void;
}

function getValue(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getArrayLength(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return Array.isArray(value) ? value.length : 0;
}

export function PendingActionCard({
  action,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: PendingActionCardProps) {
  const { payload } = action;
  const title = getValue(payload, "title");
  const company = getValue(payload, "company");
  const location = getValue(payload, "location");
  const startDate = getValue(payload, "start_date");
  const startTime = getValue(payload, "start_time");
  const endDate = getValue(payload, "end_date");
  const endTime = getValue(payload, "end_time");
  const eventType = getValue(payload, "event_type");
  const audience = getValue(payload, "audience");
  const industry = getValue(payload, "industry");
  const experienceLevel = getValue(payload, "experience_level");
  const applicationUrl = getValue(payload, "application_url");
  const contactEmail = getValue(payload, "contact_email");
  const description = getValue(payload, "description");
  const body = getValue(payload, "body");
  const threadTitle = getValue(payload, "thread_title");
  const recipientDisplayName = getValue(payload, "recipient_display_name");
  const existingChatGroupId = getValue(payload, "existing_chat_group_id");
  const groupName = getValue(payload, "group_name");
  const messageStatus = getValue(payload, "message_status");
  const mediaCount = getArrayLength(payload, "mediaIds");

  return (
    <div className="border-t border-border bg-muted/40 p-4">
      <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{action.summary.title}</p>
          <p className="text-xs text-muted-foreground">{action.summary.description}</p>
        </div>

        <div className="mt-4 space-y-2 text-sm">
          {action.actionType === "create_discussion_thread" ? (
            <>
              {title ? <p><span className="font-medium">Title:</span> {title}</p> : null}
              {body ? (
                <div>
                  <p className="font-medium text-foreground">Body</p>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{body}</p>
                </div>
              ) : null}
              {mediaCount > 0 ? (
                <p><span className="font-medium">Attachments:</span> {mediaCount}</p>
              ) : null}
            </>
          ) : action.actionType === "send_chat_message" ? (
            <>
              {recipientDisplayName ? (
                <p><span className="font-medium">Recipient:</span> {recipientDisplayName}</p>
              ) : null}
              <p>
                <span className="font-medium">Conversation:</span>{" "}
                {existingChatGroupId ? "Reuse existing 1:1 chat" : "Create new 1:1 chat"}
              </p>
              {body ? (
                <div>
                  <p className="font-medium text-foreground">Message</p>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{body}</p>
                </div>
              ) : null}
            </>
          ) : action.actionType === "send_group_chat_message" ? (
            <>
              {groupName ? (
                <p><span className="font-medium">Group:</span> {groupName}</p>
              ) : null}
              {messageStatus ? (
                <p>
                  <span className="font-medium">Delivery:</span>{" "}
                  {messageStatus === "pending" ? "Pending approval" : "Send immediately"}
                </p>
              ) : null}
              {body ? (
                <div>
                  <p className="font-medium text-foreground">Message</p>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{body}</p>
                </div>
              ) : null}
            </>
          ) : action.actionType === "create_discussion_reply" ? (
            <>
              {threadTitle ? <p><span className="font-medium">Thread:</span> {threadTitle}</p> : null}
              {body ? (
                <div>
                  <p className="font-medium text-foreground">Reply</p>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{body}</p>
                </div>
              ) : null}
            </>
          ) : action.actionType === "create_announcement" ? (
            <>
              {title ? <p><span className="font-medium">Title:</span> {title}</p> : null}
              {audience ? <p><span className="font-medium">Audience:</span> {audience}</p> : null}
              {body ? (
                <div>
                  <p className="font-medium text-foreground">Body</p>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{body}</p>
                </div>
              ) : null}
            </>
          ) : action.actionType === "create_event" ? (
            <>
              {title ? <p><span className="font-medium">Title:</span> {title}</p> : null}
              {eventType ? <p><span className="font-medium">Type:</span> {eventType}</p> : null}
              {(startDate || startTime) ? (
                <p>
                  <span className="font-medium">Starts:</span>{" "}
                  {[startDate, startTime].filter(Boolean).join(" ")}
                </p>
              ) : null}
              {(endDate || endTime) ? (
                <p>
                  <span className="font-medium">Ends:</span>{" "}
                  {[endDate, endTime].filter(Boolean).join(" ")}
                </p>
              ) : null}
              {location ? <p><span className="font-medium">Location:</span> {location}</p> : null}
              {description ? (
                <div>
                  <p className="font-medium text-foreground">Description</p>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{description}</p>
                </div>
              ) : null}
            </>
          ) : (
            <>
              {title ? <p><span className="font-medium">Title:</span> {title}</p> : null}
              {company ? <p><span className="font-medium">Company:</span> {company}</p> : null}
              {location ? <p><span className="font-medium">Location:</span> {location}</p> : null}
              {industry ? <p><span className="font-medium">Industry:</span> {industry}</p> : null}
              {experienceLevel ? <p><span className="font-medium">Experience:</span> {experienceLevel}</p> : null}
              {applicationUrl ? <p><span className="font-medium">Apply URL:</span> {applicationUrl}</p> : null}
              {contactEmail ? <p><span className="font-medium">Contact:</span> {contactEmail}</p> : null}
              {description ? (
                <div>
                  <p className="font-medium text-foreground">Description</p>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{description}</p>
                </div>
              ) : null}
            </>
          )}
        </div>

        {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : null}
            Confirm
          </button>
          <button
            type="button"
            onClick={() => void onCancel()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
