const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Marks hardware features as non-required so devices without them (Chromebooks,
 * camera-less tablets) can still install from Google Play.
 *
 * By default, declaring the CAMERA permission implicitly marks
 * `android.hardware.camera` as required, which filters out eligible devices.
 * This plugin explicitly sets those features to `required="false"`.
 */
const OPTIONAL_FEATURES = [
  "android.hardware.camera",
  "android.hardware.camera.any",
  "android.hardware.camera.autofocus",
  "android.hardware.camera.front",
];

function withOptionalHardwareFeatures(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;

    const existing = Array.isArray(manifest["uses-feature"])
      ? manifest["uses-feature"]
      : [];

    const byName = new Map(
      existing.map((feature) => [feature.$ && feature.$["android:name"], feature])
    );

    for (const name of OPTIONAL_FEATURES) {
      const current = byName.get(name);
      if (current) {
        current.$ = {
          ...current.$,
          "android:name": name,
          "android:required": "false",
        };
      } else {
        existing.push({
          $: {
            "android:name": name,
            "android:required": "false",
          },
        });
      }
    }

    modConfig.modResults.manifest["uses-feature"] = existing;
    return modConfig;
  });
}

module.exports = withOptionalHardwareFeatures;
