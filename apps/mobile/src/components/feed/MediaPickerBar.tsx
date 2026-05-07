import React from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { ImagePlus, X, AlertCircle } from "lucide-react-native";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { PendingImage } from "@/hooks/useMediaUpload";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface MediaPickerBarProps {
  readonly images: readonly PendingImage[];
  readonly isUploading: boolean;
  readonly onAddPress: () => void;
  readonly onRemove: (localUri: string) => void;
  readonly maxImages: number;
}

const THUMB_SIZE = 72;

export const MediaPickerBar = React.memo(function MediaPickerBar({
  images,
  isUploading,
  onAddPress,
  onRemove,
  maxImages,
}: MediaPickerBarProps) {
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      paddingVertical: SPACING.sm,
      borderTopWidth: 0.5,
      borderTopColor: n.border,
    },
    scrollContent: {
      paddingHorizontal: SPACING.md,
      gap: SPACING.sm,
      alignItems: "center" as const,
    },
    thumbWrapper: {
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: RADIUS.sm,
      overflow: "hidden" as const,
    },
    thumb: {
      width: THUMB_SIZE,
      height: THUMB_SIZE,
    },
    overlay: {
      ...{ position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 },
      backgroundColor: "rgba(0, 0, 0, 0.4)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    errorOverlay: {
      backgroundColor: "rgba(220, 38, 38, 0.5)",
    },
    doneOverlay: {
      backgroundColor: "rgba(5, 150, 105, 0.5)",
    },
    checkmark: {
      color: n.surface,
      fontSize: 20,
      fontWeight: "700" as const,
    },
    removeButton: {
      position: "absolute" as const,
      top: 4,
      right: 4,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: "rgba(15, 23, 42, 0.85)",
      borderWidth: 1,
      borderColor: "rgba(255, 255, 255, 0.6)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    addMoreButton: {
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: RADIUS.sm,
      borderWidth: 1.5,
      borderColor: n.border,
      borderStyle: "dashed" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    addButtonContainer: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
      borderTopWidth: 0.5,
      borderTopColor: n.border,
    },
    addPhotoButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
      paddingVertical: SPACING.xs,
    },
    addPhotoText: {
      ...TYPOGRAPHY.labelSmall,
      color: n.muted,
    },
    progressText: {
      ...TYPOGRAPHY.caption,
      color: s.info,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
    },
  }));

  if (images.length === 0 && !isUploading) {
    return (
      <View style={styles.addButtonContainer}>
        <Pressable
          onPress={onAddPress}
          style={styles.addPhotoButton}
          accessibilityLabel="Add photos"
          accessibilityRole="button"
        >
          <ImagePlus size={20} color={neutral.muted} />
          <Text style={styles.addPhotoText}>Add Photos</Text>
        </Pressable>
      </View>
    );
  }

  const uploadingCount = images.filter((img) => img.status === "uploading").length;
  const doneCount = images.filter((img) => img.status === "done").length;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {images.map((image) => (
          <View key={image.localUri} style={styles.thumbWrapper}>
            <Image
              source={{ uri: image.localUri }}
              style={styles.thumb}
              contentFit="cover"
              recyclingKey={image.localUri}
              transition={150}
            />

            {/* Upload overlay */}
            {image.status === "uploading" && (
              <View style={styles.overlay}>
                <ActivityIndicator size="small" color={neutral.surface} />
              </View>
            )}

            {/* Error overlay */}
            {image.status === "error" && (
              <View style={[styles.overlay, styles.errorOverlay]}>
                <AlertCircle size={18} color={neutral.surface} />
              </View>
            )}

            {/* Done checkmark */}
            {image.status === "done" && (
              <View style={[styles.overlay, styles.doneOverlay]}>
                <Text style={styles.checkmark}>✓</Text>
              </View>
            )}

            {/* Remove button (disabled during upload) */}
            {!isUploading && (
              <Pressable
                onPress={() => onRemove(image.localUri)}
                style={styles.removeButton}
                accessibilityLabel="Remove image"
                accessibilityRole="button"
                hitSlop={8}
              >
                <X size={12} color={neutral.surface} />
              </Pressable>
            )}
          </View>
        ))}

        {/* Add more button */}
        {images.length < maxImages && !isUploading && (
          <Pressable
            onPress={onAddPress}
            style={styles.addMoreButton}
            accessibilityLabel="Add more photos"
            accessibilityRole="button"
          >
            <ImagePlus size={24} color={neutral.muted} />
          </Pressable>
        )}
      </ScrollView>

      {/* Upload progress text */}
      {isUploading && uploadingCount > 0 && (
        <Text style={styles.progressText}>
          Uploading {doneCount + 1}/{images.length}...
        </Text>
      )}
    </View>
  );
});
