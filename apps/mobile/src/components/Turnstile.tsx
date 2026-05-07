import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { NEUTRAL, RADIUS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { getWebAppUrl } from "@/lib/web-api";

const TURNSTILE_SITE_KEY =
  process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || "1x00000000000000000000AA";

const BASE_URL = process.env.EXPO_PUBLIC_CAPTCHA_BASE_URL || getWebAppUrl();

export interface TurnstileRef {
  show: () => void;
  hide: () => void;
}

interface TurnstileProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: (error: string) => void;
  onCancel?: () => void;
  theme?: "light" | "dark";
}

interface TurnstileMessage {
  type: "open" | "verify" | "expire" | "error";
  token?: string;
  error?: string;
}

const buildHtml = (siteKey: string, theme: "light" | "dark") => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad" async defer></script>
  <style>
    html, body { margin: 0; padding: 0; background: transparent; }
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    #widget { display: flex; align-items: center; justify-content: center; padding: 16px; }
  </style>
</head>
<body>
  <div id="widget"></div>
  <script>
    function send(payload) {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    }
    window.onTurnstileLoad = function () {
      send({ type: "open" });
      try {
        window.turnstile.render("#widget", {
          sitekey: ${JSON.stringify(siteKey)},
          theme: ${JSON.stringify(theme)},
          retry: "auto",
          "refresh-expired": "auto",
          callback: function (token) { send({ type: "verify", token: token }); },
          "expired-callback": function () { send({ type: "expire" }); },
          "error-callback": function (err) { send({ type: "error", error: String(err) }); },
        });
      } catch (e) {
        send({ type: "error", error: String(e) });
      }
    };
  </script>
</body>
</html>`;

const Turnstile = forwardRef<TurnstileRef, TurnstileProps>(
  ({ onVerify, onExpire, onError, onCancel, theme = "light" }, ref) => {
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(true);
    const webViewKey = useRef(0);
    const [keyTick, setKeyTick] = useState(0);

    useImperativeHandle(ref, () => ({
      show: () => {
        webViewKey.current += 1;
        setKeyTick(webViewKey.current);
        setLoading(true);
        setVisible(true);
      },
      hide: () => {
        setVisible(false);
        setLoading(true);
      },
    }));

    const html = useMemo(() => buildHtml(TURNSTILE_SITE_KEY, theme), [theme]);

    const handleMessage = (event: WebViewMessageEvent) => {
      const raw = event?.nativeEvent?.data;
      if (!raw) return;

      let payload: TurnstileMessage;
      try {
        payload = JSON.parse(raw) as TurnstileMessage;
      } catch {
        return;
      }

      switch (payload.type) {
        case "open":
          setLoading(false);
          return;
        case "verify":
          if (payload.token) {
            setVisible(false);
            onVerify(payload.token);
          }
          return;
        case "expire":
          onExpire?.();
          return;
        case "error":
          setVisible(false);
          onError?.(payload.error || "Verification failed");
          return;
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
              <Pressable
                onPress={handleClose}
                hitSlop={8}
                style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
                accessibilityLabel="Close verification"
                accessibilityRole="button"
              >
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>

            <View style={styles.body}>
              {loading && (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={NEUTRAL.foreground} />
                  <Text style={styles.loadingText}>Loading verification…</Text>
                </View>
              )}
              <WebView
                key={keyTick}
                originWhitelist={["*"]}
                source={{ html, baseUrl: BASE_URL }}
                onMessage={handleMessage}
                javaScriptEnabled
                domStorageEnabled
                mixedContentMode="always"
                style={[styles.webview, loading && styles.hidden]}
                containerStyle={styles.webviewContainer}
                automaticallyAdjustContentInsets={false}
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
              />
            </View>
          </View>
        </View>
      </Modal>
    );
  }
);

Turnstile.displayName = "Turnstile";

export default Turnstile;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: SPACING.md,
  },
  container: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    width: "100%",
    maxWidth: 400,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: NEUTRAL.border,
  },
  title: {
    ...TYPOGRAPHY.titleMedium,
    color: NEUTRAL.foreground,
  },
  closeButton: {
    padding: 4,
  },
  closeButtonPressed: {
    opacity: 0.6,
  },
  closeText: {
    fontSize: 20,
    color: NEUTRAL.muted,
  },
  body: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingContainer: {
    paddingVertical: SPACING.xl,
    alignItems: "center",
  },
  loadingText: {
    marginTop: SPACING.sm,
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
  },
  webview: {
    width: "100%",
    height: 180,
    backgroundColor: "transparent",
  },
  webviewContainer: {
    width: "100%",
  },
  hidden: {
    position: "absolute",
    opacity: 0,
    height: 0,
  },
});
