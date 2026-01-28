import React, { useMemo, useState } from "react";
import {
  View,
  Modal,
  Pressable,
  Text,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { WebView } from "react-native-webview";
import { X } from "lucide-react-native";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import type { ThemeColors } from "@/lib/theme";

interface StripeWebViewProps {
  visible: boolean;
  url: string;
  onClose: () => void;
  title?: string;
  successUrls?: string[];
  cancelUrls?: string[];
}

export function StripeWebView({
  visible,
  url,
  onClose,
  title = "Billing",
  successUrls = [],
  cancelUrls = [],
}: StripeWebViewProps) {
  const [loading, setLoading] = useState(true);
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const handleNavigationChange = (navState: { url: string }) => {
    const currentUrl = navState.url;

    // Check for success URLs
    for (const successUrl of successUrls) {
      if (currentUrl.includes(successUrl)) {
        onClose();
        return;
      }
    }

    // Check for cancel URLs
    for (const cancelUrl of cancelUrls) {
      if (currentUrl.includes(cancelUrl)) {
        onClose();
        return;
      }
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.7 }]}>
            <X size={24} color={colors.foreground} />
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.placeholder} />
        </View>

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        )}

        <WebView
          source={{ uri: url }}
          style={styles.webview}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={handleNavigationChange}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          scalesPageToFit
        />
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    closeButton: {
      padding: 8,
    },
    title: {
      fontSize: 17,
      fontWeight: "600",
      color: colors.foreground,
    },
    placeholder: {
      width: 40,
    },
    webview: {
      flex: 1,
    },
    loadingOverlay: {
      position: "absolute",
      top: 60,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1,
    },
    loadingText: {
      marginTop: 12,
      fontSize: 16,
      color: colors.mutedForeground,
    },
  });
