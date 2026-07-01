import type { ExpoConfig } from "expo/config";

const REQUIRED_PROD_ENV = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_WEB_URL",
  "EXPO_PUBLIC_TURNSTILE_SITE_KEY",
  "EXPO_PUBLIC_CAPTCHA_BASE_URL",
  "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
] as const;

if (process.env.EAS_BUILD_PROFILE === "production") {
  const missing = REQUIRED_PROD_ENV.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    throw new Error(
      `[mobile] Missing required env for production build: ${missing.join(", ")}.\n` +
        `Set these in EAS dashboard → ${process.env.EAS_BUILD_PROFILE} environment as Plain text (not Sensitive).`,
    );
  }
}

const config: ExpoConfig = {
  name: "TeamNetwork",
  slug: "teammeet",
  owner: "teamnetwork",
  version: "1.0.0",
  platforms: ["ios", "android", "web"],
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#0f172a",
  },
  assetBundlePatterns: ["**/*"],
  runtimeVersion: {
    policy: "appVersion",
  },
  ios: {
    supportsTablet: true,
    // Phone-first, portrait-only app. With requireFullScreen omitted (default
    // false), Expo's prebuild FORCES all four orientations into
    // UISupportedInterfaceOrientations~ipad for multitasking compatibility,
    // so iPadOS rotates the portrait-designed UI into a broken landscape
    // layout. Requiring full screen disables Split View/Stage Manager and lets
    // the portrait-only orientation stick on iPad (Apple permits this).
    requireFullScreen: true,
    appleTeamId: "5GWLTFG43T",
    bundleIdentifier: "com.myteamnetwork.teammeet",
    buildNumber: "29",
    usesAppleSignIn: true,
    associatedDomains: [
      "applinks:www.myteamnetwork.com",
      "applinks:myteamnetwork.com",
    ],
    entitlements: {
      "com.apple.security.application-groups": ["group.com.teammeet.shared"],
    },
    infoPlist: {
      NSSupportsLiveActivities: true,
      NSSupportsLiveActivitiesFrequentUpdates: true,
      ITSAppUsesNonExemptEncryption: false,
      // Explicit portrait-only for iPad. ios.requireFullScreen (above) stops
      // Expo's prebuild from forcing all four orientations here; this key makes
      // the portrait lock unambiguous in the shipped plist.
      "UISupportedInterfaceOrientations~ipad": [
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationPortraitUpsideDown",
      ],
      NSCameraUsageDescription:
        "Scan a TeamNetwork QR code to join your organization or check members in at events.",
      NSCalendarsFullAccessUsageDescription:
        "Add TeamNetwork events to your device calendar so you see them alongside your other commitments.",
      NSCalendarsWriteOnlyAccessUsageDescription:
        "Add TeamNetwork events to your device calendar so you see them alongside your other commitments.",
      NSCalendarsUsageDescription:
        "Add TeamNetwork events to your device calendar so you see them alongside your other commitments.",
      NSLocationWhenInUseUsageDescription:
        "TeamNetwork uses your location to verify you're at the event venue when checking in, and to tag the location of events you create.",
      NSPhotoLibraryUsageDescription:
        "TeamNetwork needs access to your photos to attach images to posts.",
      CFBundleURLTypes: [
        {
          CFBundleURLSchemes: ["teammeet"],
        },
      ],
      UIBackgroundModes: ["remote-notification"],
    },
  },
  android: {
    package: "com.myteamnetwork.teammeet",
    versionCode: 3,
    softwareKeyboardLayoutMode: "resize",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#0f172a",
    },
    permissions: [
      "android.permission.INTERNET",
      "android.permission.VIBRATE",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.CAMERA",
      "android.permission.READ_CALENDAR",
      "android.permission.WRITE_CALENDAR",
    ],
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.USE_FINGERPRINT",
    ],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          { scheme: "https", host: "www.myteamnetwork.com", pathPrefix: "/app/join" },
          { scheme: "https", host: "www.myteamnetwork.com", pathPrefix: "/app/parents-join" },
          { scheme: "https", host: "www.myteamnetwork.com", pathPrefix: "/auth/callback" },
          { scheme: "https", host: "www.myteamnetwork.com", pathPattern: "/auth/claim(/.*)?" },
          { scheme: "https", host: "www.myteamnetwork.com", pathPattern: "/.*/announcements/.*" },
          { scheme: "https", host: "www.myteamnetwork.com", pathPattern: "/.*/events/.*" },
          { scheme: "https", host: "www.myteamnetwork.com", pathPattern: "/.*/chat/.*" },
          { scheme: "https", host: "www.myteamnetwork.com", pathPattern: "/.*/discussions/.*" },
          { scheme: "https", host: "www.myteamnetwork.com", pathPattern: "/.*/feed/.*" },
          { scheme: "https", host: "www.myteamnetwork.com", pathPattern: "/.*/jobs/.*" },
          { scheme: "https", host: "www.myteamnetwork.com", pathPattern: "/.*/mentorship/.*" },
          { scheme: "https", host: "myteamnetwork.com", pathPrefix: "/app/join" },
          { scheme: "https", host: "myteamnetwork.com", pathPrefix: "/app/parents-join" },
          { scheme: "https", host: "myteamnetwork.com", pathPrefix: "/auth/callback" },
          { scheme: "https", host: "myteamnetwork.com", pathPattern: "/auth/claim(/.*)?" },
          { scheme: "https", host: "myteamnetwork.com", pathPattern: "/.*/announcements/.*" },
          { scheme: "https", host: "myteamnetwork.com", pathPattern: "/.*/events/.*" },
          { scheme: "https", host: "myteamnetwork.com", pathPattern: "/.*/chat/.*" },
          { scheme: "https", host: "myteamnetwork.com", pathPattern: "/.*/discussions/.*" },
          { scheme: "https", host: "myteamnetwork.com", pathPattern: "/.*/feed/.*" },
          { scheme: "https", host: "myteamnetwork.com", pathPattern: "/.*/jobs/.*" },
          { scheme: "https", host: "myteamnetwork.com", pathPattern: "/.*/mentorship/.*" },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  scheme: "teammeet",
  plugins: [
    [
      "expo-router",
      {
        origin: false,
      },
    ],
    [
      "expo-secure-store",
      {
        faceIDPermission: "Use Face ID to quickly and securely sign in to TeamNetwork.",
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/notification-icon.png",
        color: "#2563eb",
        sounds: [],
        defaultChannel: "default",
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission:
          "TeamNetwork needs access to your photos to attach images to posts.",
        microphonePermission: false,
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission:
          "Scan a TeamNetwork QR code to join your organization or check members in at events.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      "expo-local-authentication",
      {
        faceIDPermission: "Use Face ID to quickly and securely sign in to TeamNetwork.",
      },
    ],
    // NOTE: We previously stripped the NSReminders* keys via a custom plugin to
    // avoid an Apple 5.1.1 over-declaration (the app uses calendar EVENTS only —
    // Calendar.EntityTypes.EVENT in src/lib/native-calendar.ts — never the
    // Reminders entity). That CRASHED the app at launch: expo-calendar v55
    // registers a Reminders permission requester at module init
    // (initializePermittedEntities -> RemindersPermissionRequester) which calls
    // RCTFatal(MissingCalendarPListValueException) when the key is absent. So we
    // must keep an NSReminders* usage string. We supply an explicit, honest
    // string below rather than expo-calendar's vague placeholder.
    [
      "expo-calendar",
      {
        calendarPermission:
          "Add TeamNetwork events to your device calendar so you see them alongside your other commitments.",
        // Required so expo-calendar's init-time Reminders requester does not
        // fatally crash (see note above). The app does not use the Reminders
        // entity, but the native module checks the permission at startup.
        remindersPermission:
          "TeamNetwork uses calendar access to add team events to your calendar.",
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "TeamNetwork uses your location to verify you're at the event venue when checking in, and to tag the location of events you create.",
        // `false` deletes the NSLocationAlways* keys (we only use
        // when-in-use, and Apple flags background-location declarations
        // that have no matching usage).
        locationAlwaysPermission: false,
        locationAlwaysAndWhenInUsePermission: false,
      },
    ],
    "expo-quick-actions",
    "expo-apple-authentication",
    [
      "@stripe/stripe-react-native",
      {
        // Apple Pay Merchant ID must be registered in App Store Connect and
        // paired with a Stripe-issued Payment Processing Certificate before
        // Apple Pay will succeed on a signed build.
        merchantIdentifier: "merchant.com.myteamnetwork.teammeet",
        enableGooglePay: false,
      },
    ],
    "./plugins/withOptionalHardwareFeatures",
    "expo-font",
    "@bacons/apple-targets",
    [
      "expo-build-properties",
      {
        ios: {
          deploymentTarget: "17.0",
        },
      },
    ],
    // Uploads source maps to Sentry during the native build so production
    // stack traces symbolicate to real file:line. org/project/auth token are
    // read from env (SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN) — set them
    // as EAS secrets; without the auth token the plugin skips upload with a
    // warning rather than failing the build.
    [
      "@sentry/react-native/expo",
      {
        url: "https://sentry.io/",
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
      },
    ],
  ],
  extra: {
    router: {
      origin: false,
    },
    eas: {
      projectId: "b5e6a305-0c4c-4c1d-b04f-cd5c3674ae9d",
    },
    privacyPolicyUrl: "https://www.myteamnetwork.com/privacy",
  },
  updates: {
    url: "https://u.expo.dev/b5e6a305-0c4c-4c1d-b04f-cd5c3674ae9d",
  },
};

export default config;
