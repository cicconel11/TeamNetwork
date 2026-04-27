import { getNonEmptyString } from "./index";

interface PendingActionToolPayload {
  pending_action?: {
    id?: unknown;
    action_type?: unknown;
    payload?: unknown;
    expires_at?: unknown;
    summary?: {
      title?: unknown;
      description?: unknown;
    } | null;
    revise_count?: unknown;
    previous_payload?: unknown;
  } | null;
  state?: unknown;
  missing_fields?: unknown;
  draft?: unknown;
  message?: unknown;
  source_warning?: unknown;
  clarification_kind?: unknown;
  candidate_recipients?: unknown;
  requested_recipient?: unknown;
  unavailable_reason?: unknown;
  candidate_groups?: unknown;
  requested_group?: unknown;
  candidate_thread_titles?: unknown;
  requested_thread_title?: unknown;
}

export function formatPrepareJobPostingResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "invalid_source_url") {
    return typeof payload.message === "string" && payload.message.length > 0
      ? `I couldn't read that job posting URL safely. ${payload.message}`
      : "I couldn't read that job posting URL safely. Please provide the job details directly.";
  }

  if (payload.state === "missing_fields") {
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];
    const sourceWarning =
      typeof payload.source_warning === "string" && payload.source_warning.length > 0
        ? payload.source_warning
        : null;

    if (missingFields.length === 0) {
      return sourceWarning
        ? `I couldn't read that job posting URL safely, but I can still draft this job if you share a few more details.`
        : "I still need a few more job details before I can prepare this posting.";
    }

    return sourceWarning
      ? `I couldn't read that job posting URL safely, so I still need: ${missingFields.join(", ")}.`
      : `I can draft this job, but I still need: ${missingFields.join(", ")}.`;
  }

  if (payload.state === "needs_confirmation") {
    return "I drafted the job posting. Review the details below and confirm when you're ready to create it.";
  }

  return null;
}

export function formatPrepareAnnouncementResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];

    if (missingFields.length === 0) {
      return "I still need an announcement title before I can prepare this post.";
    }

    return `I can draft this announcement, but I still need: ${missingFields.join(", ")}.`;
  }

  if (payload.state === "needs_confirmation") {
    return "I drafted the announcement. Review the details below and confirm when you're ready to publish it.";
  }

  return null;
}

export function formatPrepareUpdateAnnouncementResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];

    return missingFields.length > 0
      ? `I couldn't find enough information to edit that announcement. I still need: ${missingFields.join(", ")}.`
      : "I couldn't find the announcement to edit. Please identify it by title or share a more specific reference.";
  }

  if (payload.state === "needs_confirmation") {
    return "I prepared the announcement edits. Review the changes below and confirm when you're ready to update it.";
  }

  return null;
}

export function formatPrepareDeleteAnnouncementResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    return "I couldn't find the announcement to delete. Please identify it by title or share a more specific reference.";
  }

  if (payload.state === "needs_confirmation") {
    return "I found the announcement. Confirm below to delete it.";
  }

  return null;
}

export function formatPrepareEnterpriseInviteResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter(
          (field): field is string => typeof field === "string" && field.length > 0,
        )
      : [];
    if (missingFields.length === 0) {
      return "I can draft this enterprise invite, but I still need more details before I can prepare it.";
    }
    return `I can draft this enterprise invite, but I still need: ${missingFields.join(", ")}.`;
  }
  if (payload.state === "needs_confirmation") {
    return "I drafted the enterprise invite. Review the details below and confirm when you're ready to create it.";
  }
  return null;
}

export function formatRevokeEnterpriseInviteResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const payload = data as PendingActionToolPayload;
  if (payload.state === "needs_confirmation") {
    return "I found that enterprise invite. Confirm below to revoke it.";
  }
  return null;
}

export function formatPrepareDiscussionThreadResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];

    if (missingFields.length === 0) {
      return "I still need a discussion title and body before I can prepare this thread.";
    }

    return `I can draft this discussion, but I still need: ${missingFields.join(", ")}.`;
  }

  if (payload.state === "needs_confirmation") {
    return "I drafted the discussion thread. Review the details below and confirm when you're ready to post it.";
  }

  return null;
}

export function formatPrepareDiscussionReplyResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const clarificationKind = getNonEmptyString(payload.clarification_kind);
    const requestedThreadTitle = getNonEmptyString(payload.requested_thread_title);
    const candidateThreadTitles = Array.isArray(payload.candidate_thread_titles)
      ? payload.candidate_thread_titles.filter(
          (title): title is string => typeof title === "string" && title.trim().length > 0
        )
      : [];
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];

    if (clarificationKind === "thread_title_required") {
      return "I can draft this discussion reply, but I still need the thread title before I can prepare it.";
    }

    if (clarificationKind === "thread_title_ambiguous") {
      const options =
        candidateThreadTitles.length > 0
          ? candidateThreadTitles.join("; ")
          : "the matching discussion threads";
      return `I found a few discussion threads that match${
        requestedThreadTitle ? ` "${requestedThreadTitle}"` : ""
      }. Tell me which one you mean: ${options}.`;
    }

    if (clarificationKind === "thread_title_not_found") {
      if (requestedThreadTitle) {
        return `I couldn't find a discussion thread titled "${requestedThreadTitle}". Share a more specific thread title and I'll use that.`;
      }
      return "I couldn't find that discussion thread. Share a more specific thread title and I'll use that.";
    }

    if (clarificationKind === "thread_lookup_failed") {
      return "I couldn't look up that thread right now. Please try again.";
    }

    if (missingFields.length === 0) {
      return "I still need the reply body and the target discussion thread title before I can prepare this reply.";
    }

    const displayFields = missingFields.map((field) =>
      field === "discussion_thread_id" ? "thread title" : field
    );

    return `I can draft this discussion reply, but I still need: ${displayFields.join(", ")}.`;
  }

  if (payload.state === "needs_confirmation") {
    return "I drafted the discussion reply. Review the details below and confirm when you're ready to post it.";
  }

  return null;
}

export function formatPrepareChatMessageResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const clarificationKind = getNonEmptyString(payload.clarification_kind);
    const requestedRecipient = getNonEmptyString(payload.requested_recipient);
    const candidateRecipients = Array.isArray(payload.candidate_recipients)
      ? payload.candidate_recipients.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0
        )
      : [];
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];

    if (clarificationKind === "recipient_required") {
      if (missingFields.includes("body")) {
        return "I can draft that chat message, but I still need who it should go to and the message body.";
      }
      return "I can draft that chat message, but I still need to know who should receive it.";
    }

    if (clarificationKind === "recipient_ambiguous") {
      const options =
        candidateRecipients.length > 0 ? candidateRecipients.join("; ") : "the matching members";
      return `I found a few members that match${
        requestedRecipient ? ` "${requestedRecipient}"` : ""
      }. Tell me which one you mean: ${options}.`;
    }

    if (clarificationKind === "recipient_unavailable") {
      if (requestedRecipient) {
        return `I can't send an in-app chat message to "${requestedRecipient}" right now. Pick a different member or choose someone with an active linked account.`;
      }
      return "I can't send an in-app chat message to that person right now. Pick a different member or choose someone with an active linked account.";
    }

    if (missingFields.length === 0) {
      return "I still need the chat message details before I can prepare it.";
    }

    const displayFields = missingFields.map((field) =>
      field === "person_query" ? "recipient" : field
    );
    return `I can draft that chat message, but I still need: ${displayFields.join(", ")}.`;
  }

  if (payload.state === "needs_confirmation") {
    return "I drafted the chat message. Review the details below and confirm when you're ready to send it.";
  }

  return null;
}

export function formatPrepareGroupMessageResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const clarificationKind = getNonEmptyString(payload.clarification_kind);
    const requestedGroup = getNonEmptyString(payload.requested_group);
    const candidateGroups = Array.isArray(payload.candidate_groups)
      ? payload.candidate_groups
          .map((value) => {
            if (!value || typeof value !== "object") {
              return null;
            }

            return getNonEmptyString((value as { name?: unknown }).name);
          })
          .filter((value): value is string => Boolean(value))
      : [];
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];

    if (clarificationKind === "group_required") {
      if (missingFields.includes("body")) {
        return "I can draft that group message, but I still need which chat group it should go to and the message body.";
      }
      return "I can draft that group message, but I still need to know which chat group should receive it.";
    }

    if (clarificationKind === "group_ambiguous") {
      const options =
        candidateGroups.length > 0 ? candidateGroups.join("; ") : "the matching chat groups";
      return `I found a few chat groups that match${
        requestedGroup ? ` "${requestedGroup}"` : ""
      }. Tell me which one you mean: ${options}.`;
    }

    if (clarificationKind === "group_unavailable") {
      if (requestedGroup) {
        return `I can't send an in-app group chat message to "${requestedGroup}" right now. Pick a different chat group or choose one you still belong to.`;
      }
      return "I can't send an in-app group chat message there right now. Pick a different chat group or choose one you still belong to.";
    }

    if (missingFields.length === 0) {
      return "I still need the group chat message details before I can prepare it.";
    }

    const displayFields = missingFields.map((field) =>
      field === "group_name_query" ? "chat group" : field
    );
    return `I can draft that group message, but I still need: ${displayFields.join(", ")}.`;
  }

  if (payload.state === "needs_confirmation") {
    return "I drafted the group message. Review the details below and confirm when you're ready to send it.";
  }

  return null;
}

export function formatPrepareEventResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as PendingActionToolPayload;
  if (payload.state === "missing_fields") {
    const missingFields = Array.isArray(payload.missing_fields)
      ? payload.missing_fields.filter((field): field is string => typeof field === "string" && field.length > 0)
      : [];

    if (missingFields.length === 0) {
      return "I still need an event title, start date, and start time before I can prepare this event.";
    }

    return `I can draft this event, but I still need: ${missingFields.join(", ")}.`;
  }

  if (payload.state === "needs_confirmation") {
    return "I drafted the event. Review the details below and confirm when you're ready to add it to the calendar.";
  }

  return null;
}

export function formatPrepareEventsBatchResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    state?: string;
    pending_actions?: unknown[];
    validation_errors?: Array<{ index: number; missing_fields: string[] }>;
  };

  if (payload.state === "missing_fields") {
    const errors = payload.validation_errors ?? [];
    const allMissing = errors.flatMap((e) => e.missing_fields);
    const unique = [...new Set(allMissing)];
    if (unique.length === 0) {
      return "I need more details for these events before I can prepare them.";
    }
    return `None of the events are ready yet. I still need: ${unique.join(", ")} for each event.`;
  }

  if (payload.state === "needs_batch_confirmation") {
    const count = Array.isArray(payload.pending_actions) ? payload.pending_actions.length : 0;
    const errorCount = Array.isArray(payload.validation_errors) ? payload.validation_errors.length : 0;
    let msg = `I drafted ${count} event${count !== 1 ? "s" : ""}. Review the details below and confirm when you're ready.`;
    if (errorCount > 0) {
      msg += ` ${errorCount} event${errorCount !== 1 ? "s" : ""} couldn't be prepared — I'll need more details for ${errorCount === 1 ? "that one" : "those"}.`;
    }
    return msg;
  }

  return null;
}

export function formatRevisedPendingEventResponse(data: unknown, count: number): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    state?: string;
    validation_errors?: Array<{ index: number; missing_fields: string[] }>;
  };

  if (payload.state === "missing_fields") {
    const errors = Array.isArray(payload.validation_errors) ? payload.validation_errors : [];
    const missingFields = [...new Set(errors.flatMap((error) => error.missing_fields))];

    if (missingFields.length === 0) {
      return "I updated the drafted schedule, but I still need a few more details before it is ready to confirm again.";
    }

    return `I updated the drafted schedule, but I still need: ${missingFields.join(", ")} before you can confirm the revised events.`;
  }

  if (payload.state === "needs_batch_confirmation" || payload.state === "needs_confirmation") {
    return count === 1
      ? "I revised the drafted event. Review the updated details below and confirm when you're ready."
      : "I revised the drafted schedule. Review the updated details below and confirm when you're ready.";
  }

  return null;
}
