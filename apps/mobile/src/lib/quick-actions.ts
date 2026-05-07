/**
 * Home-screen Quick Actions / Siri Shortcuts (R8).
 *
 * Two action sets, swapped based on the user's last-active org role so the
 * top action matches what they'll most likely want:
 *   - admin: "Send announcement", "Start check-in", "Today's events"
 *   - member: "Today's events", "Open chat", "Scan QR"
 *
 * Actions emit a teammeet:// URL that flows through the existing
 * parseTeammeetUrl + routeIntent pipeline — same path as push taps and deep
 * links, so all later phases (R6 wallet add, R7 LA tap, etc.) compound here.
 *
 * v1 storage: AsyncStorage. App Group UserDefaults (`group.com.teammeet.shared`)
 * is reserved for P3 widget/extension work and not needed for the basic shortcut
 * flow.
 */

import * as QuickActions from "expo-quick-actions";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Router } from "expo-router";
import { parseTeammeetUrl, routeIntent, type ShortcutAction } from "@/lib/deep-link";
import { captureException } from "@/lib/analytics";

const LAST_ORG_SLUG_KEY = "teammeet.lastActiveOrgSlug.v1";
const LAST_ROLE_KEY = "teammeet.lastActiveRole.v1";

export type LastActiveRole = "admin" | "member";

export async function rememberLastActiveOrg(input: {
  orgSlug: string;
  role: LastActiveRole;
}): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(LAST_ORG_SLUG_KEY, input.orgSlug),
    AsyncStorage.setItem(LAST_ROLE_KEY, input.role),
  ]);
}

export async function clearLastActiveOrg(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(LAST_ORG_SLUG_KEY),
    AsyncStorage.removeItem(LAST_ROLE_KEY),
  ]);
}

async function readLastActive(): Promise<{ orgSlug: string | null; role: LastActiveRole }> {
  const [orgSlug, role] = await Promise.all([
    AsyncStorage.getItem(LAST_ORG_SLUG_KEY),
    AsyncStorage.getItem(LAST_ROLE_KEY),
  ]);
  return {
    orgSlug,
    role: role === "admin" ? "admin" : "member",
  };
}

interface ShortcutSpec {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  action: ShortcutAction;
}

const ADMIN_ACTIONS: ShortcutSpec[] = [
  { id: "new-announcement", title: "Send announcement", icon: "compose", action: "new-announcement" },
  { id: "check-in", title: "Start check-in", icon: "task", action: "check-in" },
  { id: "today-events", title: "Today's events", icon: "date", action: "today-events" },
];

const MEMBER_ACTIONS: ShortcutSpec[] = [
  { id: "today-events", title: "Today's events", icon: "date", action: "today-events" },
  { id: "open-chat", title: "Open chat", icon: "message", action: "open-chat" },
  { id: "scan", title: "Scan QR", icon: "search", action: "scan" },
];

function buildShortcutUrl(action: ShortcutAction, orgSlug: string | null): string {
  const params = new URLSearchParams({ action });
  if (orgSlug) params.set("org", orgSlug);
  return `teammeet://shortcut?${params.toString()}`;
}

export async function registerQuickActions(): Promise<void> {
  try {
    const supported = await QuickActions.isSupported();
    if (!supported) return;
    const { orgSlug, role } = await readLastActive();
    const set = role === "admin" ? ADMIN_ACTIONS : MEMBER_ACTIONS;
    await QuickActions.setItems(
      set.map((spec) => ({
        id: spec.id,
        title: spec.title,
        subtitle: spec.subtitle,
        icon: spec.icon,
        params: { url: buildShortcutUrl(spec.action, orgSlug) },
      }))
    );
  } catch (err) {
    captureException(err as Error, { context: "registerQuickActions" });
  }
}

export async function clearQuickActions(): Promise<void> {
  try {
    await QuickActions.setItems([]);
  } catch (err) {
    captureException(err as Error, { context: "clearQuickActions" });
  }
}

// Module-level guard: `QuickActions.initial` is the press that cold-launched
// the app. It must fire exactly once across the whole session — without this,
// every Supabase token refresh (which produces a new `session` reference and
// re-runs the subscriber effect) re-dispatches the same cold-start action,
// jumping the user to a random screen hours later.
let initialConsumed = false;

/**
 * Subscribe to quick-action presses and dispatch through routeIntent. Returns
 * a teardown for the caller's effect cleanup.
 */
export function subscribeQuickActions(router: Pick<Router, "push" | "replace">): () => void {
  const dispatch = (action: QuickActions.Action) => {
    const url = (action.params as { url?: string } | null | undefined)?.url;
    if (!url) return;
    const intent = parseTeammeetUrl(url);
    void routeIntent(router, intent, url);
  };

  if (!initialConsumed && QuickActions.initial) {
    initialConsumed = true;
    dispatch(QuickActions.initial);
  }

  const sub = QuickActions.addListener(dispatch);
  return () => sub.remove();
}
