import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function squishWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

test("latest analytics migration enforces tracking-level policy and coarse enum payloads", () => {
  const source = readSource("supabase/migrations/20260701000007_enforce_behavioral_tracking_policy.sql");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes("FROM auth.users au WHERE au.id = auth.uid()"),
    "latest analytics migration should derive age_bracket from auth.users"
  );
  assert.ok(
    normalized.includes("FROM public.organizations o WHERE o.id = p_org_id"),
    "latest analytics migration should derive org_type from the organization"
  );
  assert.ok(
    normalized.includes("IF COALESCE(v_age_bracket, '') = 'under_13' THEN RETURN FALSE; END IF;"),
    "under_13 users must stay fail-closed at the RPC boundary"
  );
  assert.ok(
    normalized.includes("IF (v_age_bracket = '13_17' OR v_org_type = 'educational') AND p_event_name NOT IN ('app_open', 'route_view') THEN RETURN FALSE; END IF;"),
    "page_view_only users and FERPA-scoped orgs must be limited to app_open/route_view"
  );
  assert.ok(
    normalized.includes("WHEN 'file_upload_attempt' THEN ARRAY['file_type','file_size_bucket','result','error_code']"),
    "file upload analytics should keep the coarse file allowlist"
  );
  assert.ok(
    normalized.includes("WHEN 'chat_message_send' THEN ARRAY['thread_id','message_type','result','error_code']"),
    "chat analytics should keep the coarse message allowlist"
  );
  assert.ok(
    normalized.includes("IF NOT (v_key = ANY (allowed_keys)) THEN CONTINUE; END IF;"),
    "non-allowlisted keys should be dropped before any extra filtering"
  );
  assert.ok(
    normalized.includes("(v_key ILIKE '%message%' AND v_key <> 'message_type')"),
    "message_type must remain allowed while other message-like keys stay blocked"
  );
  assert.ok(
    normalized.includes("(v_key ILIKE '%file%' AND v_key NOT IN ('file_type', 'file_size_bucket'))"),
    "file_type and file_size_bucket must remain allowed while other file-like keys stay blocked"
  );
  assert.ok(
    normalized.includes("IF v_key IN ('message_type', 'file_type', 'file_size_bucket') AND jsonb_typeof(v_val) <> 'string' THEN RETURN FALSE; END IF;"),
    "hardened enum props must reject non-string JSON values before primitive fallthrough"
  );
  assert.ok(
    normalized.includes("IF v_key = 'message_type' AND v_str NOT IN ('text', 'poll', 'form') THEN RETURN FALSE; END IF;"),
    "message_type must be constrained to the coarse chat analytics enum"
  );
  assert.ok(
    normalized.includes("IF v_key = 'file_type' AND v_str NOT IN ('image', 'pdf', 'doc', 'other') THEN RETURN FALSE; END IF;"),
    "file_type must be constrained to the coarse file analytics enum"
  );
  assert.ok(
    normalized.includes("IF v_key = 'file_size_bucket' AND v_str NOT IN ('<1MB', '1-5MB', '5-25MB', '25MB+') THEN RETURN FALSE; END IF;"),
    "file_size_bucket must be constrained to the coarse upload size buckets"
  );
});

test("events view tracker dedupes per org and view mode instead of suppressing all later tab changes", () => {
  const source = readSource("src/components/analytics/EventsViewTracker.tsx");
  const eventsTrackerBlock = source.match(
    /export function EventsViewTracker[\s\S]*?return null;\n}\n/
  );

  assert.ok(eventsTrackerBlock, "EventsViewTracker source block should exist");

  const normalized = squishWhitespace(eventsTrackerBlock[0]);

  assert.strictEqual(
    normalized.includes("const didTrackRef = useRef(false);"),
    false,
    "EventsViewTracker should not use a one-time boolean ref that blocks later view-mode changes"
  );
  assert.ok(
    normalized.includes("const trackKey = `${organizationId}:${viewMode}`;"),
    "EventsViewTracker should key dedupe by organization and view mode"
  );
  assert.ok(
    normalized.includes("if (lastTrackedViewRef.current === trackKey) return;"),
    "EventsViewTracker should only skip duplicate renders for the same stable view"
  );
});

test("analytics provider retries the initial org-route sync after auth hydration", () => {
  const source = readSource("src/components/analytics/AnalyticsProvider.tsx");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes("const [authReady, setAuthReady] = useState(false);"),
    "AnalyticsProvider should wait for auth hydration before deciding the initial org route is untrackable"
  );
  assert.ok(
    normalized.includes("supabase.auth.onAuthStateChange"),
    "AnalyticsProvider should subscribe to auth changes so initial tracking can retry after hydration"
  );
  assert.ok(
    normalized.includes("if (!authReady || !authUserId) { return; }"),
    "AnalyticsProvider should defer consent lookup until auth is ready instead of permanently marking the route handled"
  );
  assert.ok(
    normalized.includes("if (trackedRouteKeyRef.current === routeKey) { return; }"),
    "AnalyticsProvider should avoid duplicate route_view/app_open events when the retry path reruns"
  );
  assert.ok(
    normalized.includes("const maxOptInLevel = resolveTrackingLevel(true, authAgeBracket, orgType);"),
    "AnalyticsProvider should resolve the live tracking level from age bracket and org type"
  );
  assert.ok(
    normalized.includes("if (!canTrackBehavioralEvent(trackingLevel, \"route_view\")) { return; }"),
    "AnalyticsProvider should fail closed when the resolved tracking level does not permit route_view"
  );
});

test("jobs filters and nav clicks stay within the canonical analytics contract", () => {
  const jobsFiltersSource = readSource("src/components/jobs/JobsFilters.tsx");
  const navSource = readSource("src/components/layout/NavGroupSection.tsx");

  assert.strictEqual(
    jobsFiltersSource.includes("trackBehavioralEvent(\"directory_filter_apply\""),
    false,
    "jobs filters should not emit directory_filter_apply under the directory analytics taxonomy"
  );
  assert.strictEqual(
    navSource.includes("group_id:"),
    false,
    "nav_click should not emit undeclared group_id payload fields"
  );
});
