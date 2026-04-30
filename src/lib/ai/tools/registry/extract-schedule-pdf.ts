import { z } from "zod";
import type { AiLogContext } from "@/lib/ai/logger";
import { aiLog } from "@/lib/ai/logger";
import { isOwnedScheduleUploadPath } from "@/lib/ai/schedule-upload-path";
import type {
  ScheduleExtractionResult,
  ScheduleImageMimeType,
} from "@/lib/ai/schedule-extraction";
import { createEventPendingActionsFromDrafts } from "@/lib/ai/tools/prepare-tool-helpers";
import {
  getSafeErrorMessage,
  isScheduleImageAttachment,
} from "@/lib/ai/tools/shared";
import type { ToolExecutionContext } from "@/lib/ai/tools/executor";
import { toolError } from "@/lib/ai/tools/result";
import { isStageTimeoutError } from "@/lib/ai/timeout";
import type { ToolModule } from "./types";

const extractSchedulePdfSchema = z.object({}).strict();

type Args = z.infer<typeof extractSchedulePdfSchema>;

const MAX_SOURCE_IMAGE_BYTES = 2 * 1024 * 1024;
const SCHEDULE_UPLOAD_BUCKET = "ai-schedule-uploads";

type PdfParseCtor = typeof import("pdf-parse").PDFParse;
type ScheduleExtractionModule = typeof import("@/lib/ai/schedule-extraction");

let cachedPdfParseCtor: PdfParseCtor | null = null;
let cachedScheduleExtractionModule: ScheduleExtractionModule | null = null;

async function getPdfParseCtor(): Promise<PdfParseCtor> {
  if (cachedPdfParseCtor) {
    return cachedPdfParseCtor;
  }
  const { PDFParse } = await import("pdf-parse");
  cachedPdfParseCtor = PDFParse;
  return PDFParse;
}

async function getScheduleExtractionModule(): Promise<ScheduleExtractionModule> {
  if (cachedScheduleExtractionModule) {
    return cachedScheduleExtractionModule;
  }
  cachedScheduleExtractionModule = await import("@/lib/ai/schedule-extraction");
  return cachedScheduleExtractionModule;
}

function isScheduleImageConfigurationError(error: unknown): boolean {
  const message = getSafeErrorMessage(error);
  return /ZAI_IMAGE_MODEL|vision model|model such as glm-5v-turbo/i.test(message);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

async function extractScheduleTextFromPdfBuffer(
  pdfBuffer: Buffer,
  ctx: ToolExecutionContext,
  logContext: AiLogContext,
  extractionContext: {
    orgName?: string;
    orgId?: string;
    sourceLabel: string;
    now: string;
  }
): Promise<ScheduleExtractionResult> {
  let text = "";
  let parser: InstanceType<PdfParseCtor> | null = null;

  try {
    const PDFParse = await getPdfParseCtor();
    parser = new PDFParse({ data: pdfBuffer });
    const result = await parser.getText();
    text = result.text;
  } catch (error) {
    aiLog("warn", "ai-tools", "extract_schedule_pdf parsing failed", logContext, {
      error: getSafeErrorMessage(error),
      storagePath: ctx.attachment?.storagePath,
    });
    throw new Error("Unable to read attached PDF");
  } finally {
    if (parser) {
      await parser.destroy().catch(() => undefined);
    }
  }

  const { extractScheduleFromText } = await getScheduleExtractionModule();
  return extractScheduleFromText(text, {
    ...extractionContext,
    sourceType: "pdf",
  });
}

async function deleteScheduleUpload(
  sb: SB,
  storagePath: string,
  logContext: AiLogContext
): Promise<void> {
  try {
    const { error } = await sb.storage.from(SCHEDULE_UPLOAD_BUCKET).remove([storagePath]);

    if (error) {
      aiLog("warn", "ai-tools", "extract_schedule_pdf cleanup failed", logContext, {
        error: getSafeErrorMessage(error),
        storagePath,
      });
    }
  } catch (error) {
    aiLog("warn", "ai-tools", "extract_schedule_pdf cleanup failed", logContext, {
      error: getSafeErrorMessage(error),
      storagePath,
    });
  }
}

async function createSignedScheduleUploadUrl(
  sb: SB,
  storagePath: string,
  logContext: AiLogContext
): Promise<string> {
  const storageBucket = sb.storage.from(SCHEDULE_UPLOAD_BUCKET);

  if (typeof storageBucket.createSignedUrl !== "function") {
    throw new Error("Signed URLs are unavailable for schedule uploads");
  }

  const { data, error } = await storageBucket.createSignedUrl(storagePath, 60);
  const signedUrl =
    data && typeof data === "object" && "signedUrl" in data && typeof data.signedUrl === "string"
      ? data.signedUrl
      : null;

  if (error || !signedUrl) {
    aiLog("warn", "ai-tools", "extract_schedule_pdf signed url failed", logContext, {
      error: getSafeErrorMessage(error),
      storagePath,
    });
    throw new Error("Unable to create schedule image URL");
  }

  return signedUrl;
}

export const extractSchedulePdfModule: ToolModule<Args> = {
  name: "extract_schedule_pdf",
  argsSchema: extractSchedulePdfSchema,
  async execute(args, { ctx, sb, logContext }) {
    void args;
    if (!ctx.threadId) {
      return toolError("Event preparation requires a thread context");
    }

    if (
      !ctx.attachment ||
      (ctx.attachment.mimeType !== "application/pdf" && !isScheduleImageAttachment(ctx.attachment))
    ) {
      return toolError("Schedule attachment required", "attachment_required");
    }
    const attachment = ctx.attachment;

    if (!isOwnedScheduleUploadPath(ctx.orgId, ctx.userId, attachment.storagePath)) {
      aiLog("warn", "ai-tools", "extract_schedule_pdf invalid storage path", logContext, {
        storagePath: attachment.storagePath,
      });
      return toolError("Invalid schedule attachment path", "invalid_attachment_path");
    }

    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("slug, name")
      .eq("id", ctx.orgId)
      .maybeSingle();

    if (orgError) {
      aiLog("warn", "ai-tools", "extract_schedule_pdf org lookup failed", logContext, {
        error: getSafeErrorMessage(orgError),
      });
      return toolError("Failed to load organization context", "org_context_failed");
    }

    try {
      const { data: attachmentFile, error: downloadError } = await sb.storage
        .from(SCHEDULE_UPLOAD_BUCKET)
        .download(attachment.storagePath);

      if (downloadError || !attachmentFile) {
        aiLog("warn", "ai-tools", "extract_schedule_pdf download failed", logContext, {
          error: getSafeErrorMessage(downloadError),
          storagePath: attachment.storagePath,
        });
        return toolError("Unable to load attached schedule file", "attachment_unavailable");
      }

      const attachmentBuffer = Buffer.from(await attachmentFile.arrayBuffer());
      const extractionContext = {
        orgName: typeof org?.name === "string" ? org.name : undefined,
        orgId: ctx.orgId,
        spendBypass: ctx.aiSpendBypass,
        sourceLabel: attachment.fileName,
        now: new Date().toISOString(),
      };

      if (attachment.mimeType !== "application/pdf" && attachmentBuffer.byteLength > MAX_SOURCE_IMAGE_BYTES) {
        return toolError(
          `Image too large for extraction (${Math.round(attachmentBuffer.byteLength / 1024 / 1024)}MB). Maximum is 2MB.`,
          "image_too_large"
        );
      }

      let extracted: ScheduleExtractionResult;

      try {
        extracted =
          attachment.mimeType === "application/pdf"
            ? await extractScheduleTextFromPdfBuffer(attachmentBuffer, ctx, logContext, extractionContext)
            : await (async () => {
                const { extractScheduleFromImage } = await getScheduleExtractionModule();
                const imageUrl = await createSignedScheduleUploadUrl(
                  sb,
                  attachment.storagePath,
                  logContext
                );
                return extractScheduleFromImage(
                  {
                    url: imageUrl,
                    mimeType: attachment.mimeType as ScheduleImageMimeType,
                  },
                  {
                    ...extractionContext,
                    sourceType: "image",
                  }
                );
              })();
      } catch (error) {
        if (isStageTimeoutError(error)) {
          throw error;
        }

        if (attachment.mimeType === "application/pdf") {
          return toolError("Unable to read attached PDF", "pdf_unreadable");
        }

        if (isScheduleImageConfigurationError(error)) {
          aiLog("warn", "ai-tools", "extract_schedule_pdf image configuration invalid", logContext, {
            error: getSafeErrorMessage(error),
            storagePath: attachment.storagePath,
            mimeType: attachment.mimeType,
          });
          return toolError(
            "Schedule image extraction is misconfigured. Set ZAI_IMAGE_MODEL to a Z.AI vision model such as glm-5v-turbo.",
            "image_model_misconfigured"
          );
        }

        aiLog("warn", "ai-tools", "extract_schedule_pdf image extraction failed", logContext, {
          error: getSafeErrorMessage(error),
          storagePath: attachment.storagePath,
          mimeType: attachment.mimeType,
        });
        return toolError("Unable to read attached schedule image", "image_unreadable");
      }

      if (extracted.diagnostics) {
        aiLog("info", "ai-tools", "extract_schedule_pdf extraction completed", logContext, {
          storagePath: attachment.storagePath,
          mimeType: attachment.mimeType,
          strategy: extracted.diagnostics.strategy,
          cleanedLineCount: extracted.diagnostics.cleaned_line_count,
          parsedRowCount: extracted.diagnostics.parsed_row_count,
          candidateRowCount: extracted.diagnostics.candidate_row_count,
        });
      }

      const extractionValidationErrors = extracted.rejected_rows ?? [];

      if (extracted.events.length === 0 && extractionValidationErrors.length === 0) {
        return {
          kind: "ok",
          data: {
            state: "no_events_found",
            source_file: attachment.fileName,
          },
        };
      }

      const { pendingActions, validationErrors } = await createEventPendingActionsFromDrafts(
        sb,
        ctx,
        extracted.events,
        logContext,
        typeof org?.slug === "string" ? org.slug : null
      );
      const allValidationErrors = [...extractionValidationErrors, ...validationErrors];

      if (pendingActions.length === 0) {
        return {
          kind: "ok",
          data: {
            state: "missing_fields",
            validation_errors: allValidationErrors,
          },
        };
      }

      return {
        kind: "ok",
        data: {
          state: "needs_batch_confirmation",
          pending_actions: pendingActions,
          validation_errors: allValidationErrors.length > 0 ? allValidationErrors : undefined,
        },
      };
    } finally {
      await deleteScheduleUpload(sb, attachment.storagePath, logContext);
    }
  },
};
