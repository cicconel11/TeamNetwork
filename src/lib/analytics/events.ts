"use client";

import { createClient } from "@/lib/supabase/client";

export type AnalyticsEventName =
  | "app_open"
  | "route_view"
  | "nav_click"
  | "cta_click"
  | "page_dwell_bucket"
  | "directory_view"
  | "directory_filter_apply"
  | "directory_sort_change"
  | "profile_card_open"
  | "events_view"
  | "event_open"
  | "rsvp_update"
  | "form_open"
  | "form_submit"
  | "file_upload_attempt"
  | "donation_flow_start"
  | "donation_checkout_start"
  | "donation_checkout_result"
  | "chat_thread_open"
  | "chat_message_send"
  | "chat_participants_change";

export type OpsEventName = "api_error" | "client_error" | "auth_fail" | "rate_limited";

export type ConsentState = "opted_in" | "opted_out" | "unknown";

type ReferrerType = "direct" | "invite_link" | "deeplink" | "notification" | "email_link";

type DeviceClass = "mobile" | "tablet" | "desktop";

const ANALYTICS_SESSION_KEY = "tn_analytics_session";

const consentByOrg = new Map<string, ConsentState>();
let cachedSessionId: string | null = null;
let cachedSessionDay: string | null = null;

function getClientDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function generateUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sess_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function getAnalyticsSessionId(): string {
  const today = getClientDay();

  if (cachedSessionId && cachedSessionDay === today) {
    return cachedSessionId;
  }

  if (typeof window === "undefined") return "unknown";

  try {
    const stored = sessionStorage.getItem(ANALYTICS_SESSION_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { id?: string; day?: string };
      if (parsed?.id && parsed?.day === today) {
        cachedSessionId = parsed.id;
        cachedSessionDay = parsed.day;
        return parsed.id;
      }
    }

    const id = generateUuid();
    sessionStorage.setItem(ANALYTICS_SESSION_KEY, JSON.stringify({ id, day: today }));
    cachedSessionId = id;
    cachedSessionDay = today;
    return id;
  } catch {
    const id = generateUuid();
    cachedSessionId = id;
    cachedSessionDay = today;
    return id;
  }
}

function getAppVersion(): string {
  if (typeof process !== "undefined") {
    return process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";
  }
  return "unknown";
}

function getDeviceClass(): DeviceClass {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w < 768) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

function getRoute(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname;
}

function getReferrerType(): ReferrerType {
  if (typeof window === "undefined") return "direct";

  const url = new URL(window.location.href);
  const source = url.searchParams.get("source") || url.searchParams.get("ref");
  if (source === "invite" || source === "invite_link") return "invite_link";
  if (source === "notification") return "notification";
  if (source === "deeplink") return "deeplink";
  if (source === "email" || source === "email_link") return "email_link";

  const referrer = document.referrer?.toLowerCase() ?? "";
  if (!referrer) return "direct";
  if (referrer.includes("mail")) return "email_link";
  return "deeplink";
}

export function setConsentState(orgId: string, state: ConsentState): void {
  consentByOrg.set(orgId, state);

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("analytics:consent-change", {
        detail: { orgId, consentState: state, consented: state === "opted_in" },
      }),
    );
  }
}

export function getConsentState(orgId: string | undefined | null): ConsentState {
  if (!orgId) return "unknown";
  return consentByOrg.get(orgId) ?? "unknown";
}

export function getAnalyticsSessionMetadata() {
  return {
    session_id: getAnalyticsSessionId(),
    client_day: getClientDay(),
  };
}

export function trackBehavioralEvent(
  event_name: AnalyticsEventName,
  props: Record<string, unknown> = {},
  orgId?: string | null,
): void {
  if (!orgId) return;
  const consentState = getConsentState(orgId);
  if (consentState !== "opted_in") return;

  const supabase = createClient();

  const payload = {
    p_org_id: orgId,
    p_session_id: getAnalyticsSessionId(),
    p_client_day: getClientDay(),
    p_platform: "web",
    p_device_class: getDeviceClass(),
    p_app_version: getAppVersion(),
    p_route: getRoute(),
    p_event_name: event_name,
    p_props: {
      ...props,
      referrer_type: getReferrerType(),
      consent_state: consentState,
    },
  };

  // Fire-and-forget; do not block UI on analytics.
  void supabase.rpc("log_analytics_event", payload);
}

export function trackOpsEvent(
  event_name: OpsEventName,
  props: {
    endpoint_group?: string;
    http_status?: number;
    error_code?: string;
    retryable?: boolean;
  } = {},
  orgId?: string | null,
): void {
  const supabase = createClient();

  const payload = {
    p_org_id: orgId ?? null,
    p_session_id: getAnalyticsSessionId(),
    p_client_day: getClientDay(),
    p_platform: "web",
    p_device_class: getDeviceClass(),
    p_app_version: getAppVersion(),
    p_route: getRoute(),
    p_event_name: event_name,
    p_endpoint_group: props.endpoint_group ?? null,
    p_http_status: props.http_status ?? null,
    p_error_code: props.error_code ?? null,
    p_retryable: props.retryable ?? null,
  };

  // Fire-and-forget; do not block UI on ops telemetry.
  void supabase.rpc("log_ops_event", payload);
}
