import { Platform, type ViewStyle } from "react-native";

/**
 * iOS-only continuous corner curve style.
 *
 * React Native supports `borderCurve` at runtime on iOS, but the property is not
 * consistently present in the TypeScript ViewStyle definition across RN/Expo
 * versions. Keep the narrow type escape centralized instead of scattering
 * `@ts-ignore` comments through component styles.
 */
export const continuousBorderCurve: ViewStyle =
  Platform.OS === "ios" ? ({ borderCurve: "continuous" } as ViewStyle) : {};
