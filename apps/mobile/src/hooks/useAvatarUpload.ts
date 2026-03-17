import { useState, useCallback } from "react";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { validatePickedImage } from "@/hooks/useMediaUpload";
import * as sentry from "@/lib/analytics/sentry";

export interface AvatarUploadState {
  readonly isUploading: boolean;
  readonly error: string | null;
}

export function useAvatarUpload(userId: string | undefined) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickAndUpload = useCallback(async (): Promise<string | null> => {
    if (!userId) {
      setError("User not authenticated");
      return null;
    }

    setError(null);

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      setError("Photo library access is required to update your avatar");
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];

    if (!asset) {
      return null;
    }

    const validationError = validatePickedImage(asset);
    if (validationError) {
      setError(validationError);
      return null;
    }

    setIsUploading(true);

    try {
      const uri = asset.uri;
      const ext = (asset.fileName?.split(".").pop() ?? "jpg").toLowerCase();
      const path = `${userId}/avatar.${ext}`;

      const response = await fetch(uri);
      const blob = await response.blob();

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, blob, {
          contentType: asset.mimeType ?? "image/jpeg",
          upsert: true,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: publicUrlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(path);

      const avatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: avatarUrl },
      });

      if (updateError) {
        throw updateError;
      }

      return avatarUrl;
    } catch (e) {
      const message = (e as Error).message || "Failed to upload avatar";
      setError(message);
      sentry.captureException(e as Error, {
        context: "useAvatarUpload.pickAndUpload",
        userId,
      });
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [userId]);

  return {
    isUploading,
    error,
    pickAndUpload,
  } as const;
}
