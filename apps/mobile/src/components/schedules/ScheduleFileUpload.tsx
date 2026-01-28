import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Upload } from "lucide-react-native";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";

interface ScheduleFileUploadProps {
  onUpload: (file: {
    uri: string;
    name: string;
    mimeType: string;
    size: number;
  }) => Promise<{ success: boolean; error?: string }>;
}

const UPLOAD_COLORS = {
  primary: "#059669",
  primaryText: "#ffffff",
  error: "#ef4444",
  errorBg: "#fee2e2",
  secondaryText: "#64748b",
};

export function ScheduleFileUpload({ onUpload }: ScheduleFileUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePickDocument = async () => {
    try {
      setError(null);

      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/png", "image/jpeg", "image/jpg"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];

      if (!file.uri || !file.name || !file.mimeType) {
        setError("Invalid file selected");
        return;
      }

      // Validate file size (10MB max)
      if (file.size && file.size > 10 * 1024 * 1024) {
        setError("File size must be under 10MB");
        return;
      }

      setIsUploading(true);

      const uploadResult = await onUpload({
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size || 0,
      });

      if (!uploadResult.success) {
        setError(uploadResult.error || "Upload failed");
      }
    } catch (e) {
      const err = e as Error;
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
        onPress={handlePickDocument}
        disabled={isUploading}
      >
        {isUploading ? (
          <ActivityIndicator size="small" color={UPLOAD_COLORS.primaryText} />
        ) : (
          <>
            <Upload size={16} color={UPLOAD_COLORS.primaryText} />
            <Text style={styles.buttonText}>Upload Schedule</Text>
          </>
        )}
      </Pressable>
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: UPLOAD_COLORS.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  buttonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: UPLOAD_COLORS.primaryText,
  },
  errorContainer: {
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: UPLOAD_COLORS.errorBg,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: UPLOAD_COLORS.error,
  },
});
