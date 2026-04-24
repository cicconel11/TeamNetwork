export function formatExtractScheduleFileResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    state?: string;
    pending_actions?: unknown[];
    validation_errors?: Array<{ index: number; missing_fields: string[] }>;
    source_file?: unknown;
  };

  if (payload.state === "no_events_found") {
    return "I couldn't find any usable events in that schedule file. Try a clearer photo or upload a PDF export if you have one.";
  }

  if (payload.state === "missing_fields") {
    const errors = Array.isArray(payload.validation_errors) ? payload.validation_errors : [];
    const missingFields = [...new Set(errors.flatMap((error) => error.missing_fields))];

    if (missingFields.length === 0) {
      return "I could read the schedule file, but I need a few more event details before I can prepare anything for confirmation.";
    }

    return `I could read the schedule file, but I still need: ${missingFields.join(", ")} before I can prepare those events.`;
  }

  if (payload.state === "needs_batch_confirmation") {
    const count = Array.isArray(payload.pending_actions) ? payload.pending_actions.length : 0;
    const skipped = Array.isArray(payload.validation_errors) ? payload.validation_errors.length : 0;
    let message = `I drafted ${count} event${count === 1 ? "" : "s"} from that schedule file. Review the details below and confirm when you're ready.`;
    if (skipped > 0) {
      message += ` ${skipped} event${skipped === 1 ? "" : "s"} still need more details.`;
    }
    return message;
  }

  return null;
}
