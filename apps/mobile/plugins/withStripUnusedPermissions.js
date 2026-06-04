const { withInfoPlist } = require("expo/config-plugins");

/**
 * Deletes iOS Info.plist permission keys that an upstream config plugin injects
 * unconditionally but that this app never actually requests.
 *
 * The `expo-calendar` plugin always writes NSRemindersUsageDescription and
 * NSRemindersFullAccessUsageDescription via its own `withInfoPlist` mod — and
 * when no `remindersPermission` string is supplied it falls back to the generic
 * placeholder "Allow $(PRODUCT_NAME) to access your reminders". The app only
 * touches the calendar EVENT entity (Calendar.EntityTypes.EVENT in
 * src/lib/native-calendar.ts) and never the Reminders entity, so shipping these
 * keys is an Apple Guideline 5.1.1 over-declaration (a usage string for a
 * permission the binary never asks for, with vague placeholder copy).
 *
 * Expo executes `withInfoPlist` mods in REVERSE plugin-registration order (the
 * chain unwinds last-in-first-out), so to run AFTER expo-calendar's mod this
 * plugin must be registered BEFORE "expo-calendar" in app.config.ts plugins[].
 */
const KEYS_TO_REMOVE = [
  "NSRemindersUsageDescription",
  "NSRemindersFullAccessUsageDescription",
];

function withStripUnusedPermissions(config) {
  return withInfoPlist(config, (modConfig) => {
    for (const key of KEYS_TO_REMOVE) {
      delete modConfig.modResults[key];
    }
    return modConfig;
  });
}

module.exports = withStripUnusedPermissions;
