import { z } from "zod";
import { aiLog } from "@/lib/ai/logger";
import { createEventPendingActionsFromDrafts } from "@/lib/ai/tools/prepare-tool-helpers";
import { getSafeErrorMessage } from "@/lib/ai/tools/shared";
import { toolError } from "@/lib/ai/tools/result";
import { ScheduleSecurityError } from "@/lib/schedule-security/errors";
import { fetchUrlSafe } from "@/lib/schedule-security/fetchUrlSafe";
import type { ToolModule } from "./types";

const scrapeScheduleWebsiteSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();

type Args = z.infer<typeof scrapeScheduleWebsiteSchema>;

const SCRAPE_SCHEDULE_FETCH_TIMEOUT_MS = 10_000;
const SCRAPE_SCHEDULE_MAX_BYTES = 512 * 1024;

type CheerioLoad = typeof import("cheerio").load;
type ScheduleExtractionModule = typeof import("@/lib/ai/schedule-extraction");

let cachedCheerioLoad: CheerioLoad | null = null;
let cachedScheduleExtractionModule: ScheduleExtractionModule | null = null;

async function getCheerioLoad(): Promise<CheerioLoad> {
  if (cachedCheerioLoad) {
    return cachedCheerioLoad;
  }
  const { load } = await import("cheerio");
  cachedCheerioLoad = load;
  return load;
}

async function getScheduleExtractionModule(): Promise<ScheduleExtractionModule> {
  if (cachedScheduleExtractionModule) {
    return cachedScheduleExtractionModule;
  }
  cachedScheduleExtractionModule = await import("@/lib/ai/schedule-extraction");
  return cachedScheduleExtractionModule;
}

function normalizeScrapedScheduleText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export const scrapeScheduleWebsiteModule: ToolModule<Args> = {
  name: "scrape_schedule_website",
  argsSchema: scrapeScheduleWebsiteSchema,
  async execute(args, { ctx, sb, logContext }) {
    if (!ctx.threadId) {
      return toolError("Event preparation requires a thread context");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(args.url);
    } catch {
      return toolError("Invalid schedule website URL");
    }

    if (parsedUrl.protocol !== "https:") {
      return toolError("Schedule website URL must use HTTPS");
    }

    const { data: org, error: orgError } = await sb
      .from("organizations")
      .select("slug, name")
      .eq("id", ctx.orgId)
      .maybeSingle();

    if (orgError) {
      aiLog("warn", "ai-tools", "scrape_schedule_website org lookup failed", logContext, {
        error: getSafeErrorMessage(orgError),
      });
      return toolError("Failed to load organization context");
    }

    let response: Awaited<ReturnType<typeof fetchUrlSafe>>;
    try {
      response = await fetchUrlSafe(args.url, {
        timeoutMs: SCRAPE_SCHEDULE_FETCH_TIMEOUT_MS,
        maxBytes: SCRAPE_SCHEDULE_MAX_BYTES,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain",
        },
        orgId: ctx.orgId,
        userId: ctx.userId,
        supabase: sb,
        allowlistMode: "enforce",
      });
    } catch (error) {
      if (error instanceof ScheduleSecurityError) {
        return toolError(error.message);
      }

      aiLog("warn", "ai-tools", "scrape_schedule_website fetch failed", logContext, {
        error: getSafeErrorMessage(error),
      });
      return toolError("Unable to fetch schedule website");
    }

    const load = await getCheerioLoad();
    const $ = load(response.text);
    $("script, style, nav, footer").remove();

    const main = $("main").first();
    const text = normalizeScrapedScheduleText((main.length ? main : $("body")).text());
    const { extractScheduleFromText } = await getScheduleExtractionModule();
    const extracted = await extractScheduleFromText(text, {
      orgName: typeof org?.name === "string" ? org.name : undefined,
      sourceType: "website",
      sourceLabel: response.finalUrl,
      now: new Date().toISOString(),
    });

    if (extracted.events.length === 0) {
      return {
        kind: "ok",
        data: {
          state: "no_events_found",
          source_url: args.url,
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

    if (pendingActions.length === 0) {
      return {
        kind: "ok",
        data: {
          state: "missing_fields",
          validation_errors: validationErrors,
        },
      };
    }

    return {
      kind: "ok",
      data: {
        state: "needs_batch_confirmation",
        pending_actions: pendingActions,
        validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
      },
    };
  },
};
