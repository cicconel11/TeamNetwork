import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";

type StyleFactory<T extends StyleSheet.NamedStyles<T>> = (
  neutral: NeutralColors,
  semantic: SemanticColors
) => T;

export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: StyleFactory<T>
): T {
  const { neutral, semantic } = useAppColorScheme();
  return useMemo(
    () => StyleSheet.create(factory(neutral, semantic)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- factory excluded intentionally:
    // all 109 call-sites pass inline arrows, which create new refs every render.
    // Deps are neutral + semantic only; style output changes only when theme changes.
    [neutral, semantic]
  );
}
