import { Alert, Platform } from "react-native";

/**
 * Cross-platform alert that works in both native and web environments.
 * Uses window.alert on web, Alert.alert on native.
 */
export function showAlert(title: string, message: string, onPress?: () => void) {
    if (Platform.OS === "web") {
        window.alert(`${title}\n\n${message}`);
        if (onPress) {
            onPress();
        }
    } else {
        Alert.alert(title, message, [{ text: "OK", onPress }]);
    }
}
