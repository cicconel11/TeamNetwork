import { Platform } from "react-native";
import { requireNativeModule } from "expo-modules-core";

/**
 * Local Expo Module bridge to iOS ActivityKit.
 *
 * Available on iOS 17+ only. On Android / web / older iOS the native module is
 * not registered, so we surface a stub that resolves "not supported" rather
 * than crash. Callers should always check `isSupported()` first or call from
 * inside the LiveActivityContext (which already gates by Platform.OS).
 */

export interface LiveActivityContentState {
  checkedInCount: number;
  totalAttending: number;
  isCheckedIn: boolean;
  /** 'live' | 'starting' | 'ended' | 'cancelled' */
  status: string;
  /** Activity end timestamp (Unix seconds). */
  endsAt: number;
}

export interface LiveActivityStartArgs {
  eventId: string;
  orgSlug: string;
  orgName: string;
  eventTitle: string;
  contentState: LiveActivityContentState;
  /** Optional unix-seconds when the on-device card should grey out as stale. */
  staleDate?: number;
}

export interface LiveActivityStartResult {
  activityId: string;
  /** Hex push token. May be empty on first call; listen for `onPushTokenUpdate`. */
  pushToken: string;
}

export type LiveActivityDismissalPolicy = "immediate" | "default";

export interface LiveActivityActiveRecord {
  activityId: string;
  eventId: string;
  orgSlug: string;
}

export interface LiveActivityPushTokenUpdate {
  activityId: string;
  pushToken: string;
}

interface NativeListenerSubscription {
  remove: () => void;
}

interface NativeLiveActivityModule {
  isSupported: () => Promise<boolean>;
  start: (args: LiveActivityStartArgs) => Promise<LiveActivityStartResult | null>;
  update: (activityId: string, contentState: LiveActivityContentState) => Promise<void>;
  end: (
    activityId: string,
    finalContentState?: LiveActivityContentState,
    dismissalPolicy?: LiveActivityDismissalPolicy,
  ) => Promise<void>;
  endAll: (dismissalPolicy?: LiveActivityDismissalPolicy) => Promise<void>;
  listActive: () => Promise<LiveActivityActiveRecord[]>;
  /**
   * Expo Modules Core injects an `addListener(eventName, handler)` method on
   * every native module that declares `Events(...)`. We type it loosely here
   * so the JS bridge stays decoupled from the EventEmitter generics.
   */
  addListener?: (
    eventName: string,
    handler: (event: unknown) => void,
  ) => NativeListenerSubscription;
}

const stubModule: NativeLiveActivityModule = {
  isSupported: async () => false,
  start: async () => null,
  update: async () => undefined,
  end: async () => undefined,
  endAll: async () => undefined,
  listActive: async () => [],
};

function loadNativeModule(): NativeLiveActivityModule {
  if (Platform.OS !== "ios") return stubModule;
  try {
    return requireNativeModule<NativeLiveActivityModule>("LiveActivityModule");
  } catch {
    // Older builds without the widget extension shipped won't have the native
    // module registered. Fall back silently — host code should guard with
    // `isSupported()` anyway.
    return stubModule;
  }
}

const native = loadNativeModule();

export const LiveActivityNative = native;

export function addPushTokenListener(
  listener: (event: LiveActivityPushTokenUpdate) => void,
): { remove: () => void } {
  if (Platform.OS !== "ios" || typeof native.addListener !== "function") {
    return { remove: () => undefined };
  }
  const subscription = native.addListener(
    "onPushTokenUpdate",
    (event: unknown) => {
      listener(event as LiveActivityPushTokenUpdate);
    },
  );
  return { remove: () => subscription.remove() };
}
