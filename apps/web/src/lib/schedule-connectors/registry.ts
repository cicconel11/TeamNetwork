import { fetchUrlSafe } from "./fetch";
import { genericHtmlConnector } from "./genericHtml";
import { googleCalendarConnector } from "./googleCalendar";
import { icsConnector } from "./ics";
import { vendorAConnector } from "./vendorA";
import { vendorBConnector } from "./vendorB";
import type { ScheduleConnector, VendorId } from "./types";

export const connectors: ScheduleConnector[] = [
  icsConnector,
  vendorAConnector,
  vendorBConnector,
  googleCalendarConnector,
  genericHtmlConnector,
];

export async function detectConnector(
  url: string,
  context: { orgId?: string } = {}
): Promise<{ connector: ScheduleConnector; confidence: number }> {
  // Google Calendar URLs don't need HTTP fetch or content detection
  if (url.startsWith("google://")) {
    return { connector: googleCalendarConnector, confidence: 1.0 };
  }

  const icsCheck = await icsConnector.canHandle({ url });
  if (icsCheck.ok && icsCheck.confidence >= 0.9) {
    return { connector: icsConnector, confidence: icsCheck.confidence };
  }

  let html: string | undefined;
  let headers: Record<string, string> | undefined;

  try {
    const result = await fetchUrlSafe(url, { mode: "verify", orgId: context.orgId });
    html = result.text;
    headers = result.headers;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    html = undefined;
  }

  let best: { connector: ScheduleConnector; confidence: number } | null = null;

  for (const connector of connectors) {
    if (connector.id === "ics" && headers) {
      const check = await connector.canHandle({ url, headers });
      if (check.ok && check.confidence > (best?.confidence ?? 0)) {
        best = { connector, confidence: check.confidence };
      }
      continue;
    }

    if (connector.id === "ics") {
      continue;
    }

    const check = await connector.canHandle({ url, html, headers });
    if (check.ok && check.confidence > (best?.confidence ?? 0)) {
      best = { connector, confidence: check.confidence };
    }
  }

  if (best) {
    return best;
  }

  if (icsCheck.ok) {
    return { connector: icsConnector, confidence: icsCheck.confidence };
  }

  throw new Error("No supported schedule connector found for this URL.");
}

export function getConnectorById(id: VendorId): ScheduleConnector | null {
  return connectors.find((connector) => connector.id === id) ?? null;
}
