import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View, Modal, ActivityIndicator, Text, TouchableOpacity } from "react-native";
import ConfirmHcaptcha from "@hcaptcha/react-native-hcaptcha";

// Get site key from environment or use Supabase's default test key
const HCAPTCHA_SITE_KEY = process.env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY || "10000000-ffff-ffff-ffff-000000000001";

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

    const handleMessage = (event: string) => {
      if (event === "cancel") {
        setVisible(false);
        onCancel?.();
        return;
      }
      if (event === "error") {
        setVisible(false);
        onError?.("CAPTCHA verification failed");
        return;
      }
      if (event === "expired") {
        setVisible(false);
        onExpire?.();
        return;
      }
      if (event === "open") {
        setLoading(false);
        return;
      }
      // Event is the token
      if (event && event.length > 20) {
        setVisible(false);
        onVerify(event);
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
              <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>
            
            {loading && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
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
                baseUrl="https://hcaptcha.com"
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

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    backgroundColor: "white",
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
    borderBottomColor: "#e0e0e0",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  closeButton: {
    padding: 4,
  },
  closeText: {
    fontSize: 20,
    color: "#666",
  },
  loadingContainer: {
    padding: 48,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: "#666",
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
