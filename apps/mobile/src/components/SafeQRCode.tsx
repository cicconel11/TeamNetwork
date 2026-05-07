import { Component, type ReactNode } from "react";
import { View, Text, StyleSheet } from "react-native";
import QRCode from "react-native-qrcode-svg";

interface Props {
  value: string;
  size?: number;
  backgroundColor?: string;
  color?: string;
  fallbackTextColor?: string;
}

interface State {
  hasError: boolean;
  message: string | null;
}

/**
 * Wraps `react-native-qrcode-svg` so a generation failure renders a readable
 * fallback instead of a blank box. The library throws synchronously when the
 * encoder rejects the input (empty string, capacity exceeded, etc.).
 */
export class SafeQRCode extends Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(err: unknown): State {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : "Failed to render QR code",
    };
  }

  componentDidCatch(err: unknown) {
    console.warn("[qr-code] mobile generation failed:", err);
  }

  componentDidUpdate(prev: Props) {
    if (prev.value !== this.props.value && this.state.hasError) {
      this.setState({ hasError: false, message: null });
    }
  }

  render() {
    const { value, size = 180, backgroundColor, color, fallbackTextColor } = this.props;

    if (!value || !value.trim()) {
      return (
        <View style={[styles.fallback, { width: size, height: size }]}>
          <Text style={[styles.text, { color: fallbackTextColor ?? "#666" }]}>
            No link available
          </Text>
        </View>
      );
    }

    if (this.state.hasError) {
      return (
        <View style={[styles.fallback, { width: size, height: size }]}>
          <Text style={[styles.text, { color: fallbackTextColor ?? "#666" }]}>
            Couldn&apos;t render QR code
          </Text>
        </View>
      );
    }

    return (
      <QRCode value={value} size={size} backgroundColor={backgroundColor} color={color} />
    );
  }
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  text: {
    fontSize: 13,
    textAlign: "center",
  },
});
