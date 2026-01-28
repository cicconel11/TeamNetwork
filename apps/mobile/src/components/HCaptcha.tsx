import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet, View, Modal, ActivityIndicator, Text, Pressable } from "react-native";
import ConfirmHcaptcha from "@hcaptcha/react-native-hcaptcha";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import type { ThemeColors } from "@/lib/theme";

// Get site key from environment or use hCaptcha's test key
const HCAPTCHA_SITE_KEY = process.env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY || "10000000-ffff-ffff-ffff-000000000001";
const HCAPTCHA_BASE_URL =
  process.env.EXPO_PUBLIC_HCAPTCHA_BASE_URL ||
  process.env.EXPO_PUBLIC_WEB_URL ||
  "https://www.myteamnetwork.com";

export interface HCaptchaRef {
  show: () => void;
  hide: () => void;
}

interface HCaptchaProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: (error: string) => void;
  onCancel?: () => void;
}

const HCaptcha = forwardRef<HCaptchaRef, HCaptchaProps>(
  ({ onVerify, onExpire, onError, onCancel }, ref) => {
    const captchaRef = useRef<ConfirmHcaptcha>(null);
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(true);
    const { colors } = useOrgTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);

    useImperativeHandle(ref, () => ({
      show: () => {
        setVisible(true);
        setLoading(true);
        setTimeout(() => {
          captchaRef.current?.show();
        }, 100);
      },
      hide: () => {
        setVisible(false);
        setLoading(true);
      },
    }));

    const handleMessage = (event: any) => {
      const data: string | undefined =
        typeof event === "string" ? event : event?.nativeEvent?.data;

      if (!data) return;

      if (data === "cancel") {
        setVisible(false);
        onCancel?.();
        return;
      }
      if (data === "error") {
        setVisible(false);
        onError?.("CAPTCHA verification failed");
        return;
      }
      if (data === "expired") {
        setVisible(false);
        onExpire?.();
        return;
      }
      if (data === "open") {
        setLoading(false);
        return;
      }
      // Event is the token
      if (data.length > 20) {
        setVisible(false);
        onVerify(data);
      }
    };

    const handleClose = () => {
      setVisible(false);
      onCancel?.();
    };

    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={handleClose}
      >
        <View style={styles.overlay}>
          <View style={styles.container}>
            <View style={styles.header}>
              <Text style={styles.title}>Security Check</Text>
              <Pressable onPress={handleClose} style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.7 }]}>
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>
            
            {loading && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>Loading verification...</Text>
              </View>
            )}
            
            <View style={[styles.captchaContainer, loading && styles.hidden]}>
              <ConfirmHcaptcha
                ref={captchaRef}
                siteKey={HCAPTCHA_SITE_KEY}
                onMessage={handleMessage}
                languageCode="en"
                showLoading={false}
                size="normal"
                baseUrl={HCAPTCHA_BASE_URL}
              />
            </View>
          </View>
        </View>
      </Modal>
    );
  }
);

HCaptcha.displayName = "HCaptcha";

export default HCaptcha;

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      alignItems: "center",
    },
    container: {
      backgroundColor: colors.card,
      borderRadius: 16,
      width: "90%",
      maxWidth: 400,
      overflow: "hidden",
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      fontSize: 18,
      fontWeight: "600",
      color: colors.foreground,
    },
    closeButton: {
      padding: 4,
    },
    closeText: {
      fontSize: 20,
      color: colors.mutedForeground,
    },
    loadingContainer: {
      padding: 48,
      alignItems: "center",
    },
    loadingText: {
      marginTop: 16,
      fontSize: 14,
      color: colors.mutedForeground,
    },
    captchaContainer: {
      minHeight: 100,
      alignItems: "center",
      justifyContent: "center",
    },
    hidden: {
      position: "absolute",
      opacity: 0,
    },
  });
