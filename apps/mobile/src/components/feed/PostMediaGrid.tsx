import React, { useRef, useState, useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { supabase } from "@/lib/supabase";
import { RADIUS, SPACING } from "@/lib/design-tokens";
import type { MediaAttachment } from "@/types/feed";

interface PostMediaGridProps {
  media: MediaAttachment[];
}

interface CachedUrl {
  url: string;
  expiresAt: number;
}

const SIGNED_URL_TTL_MS = 3_540_000; // 59 minutes (URL valid for 60 min)

export function PostMediaGrid({ media }: PostMediaGridProps) {
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const urlCacheRef = useRef<Record<string, CachedUrl>>({});

  useEffect(() => {
    let cancelled = false;

    async function generateUrls() {
      const newUrls: Record<string, string> = {};
      for (const item of media) {
        // Use cached URL if not expired
        const cached = urlCacheRef.current[item.id];
        if (cached && Date.now() < cached.expiresAt) {
          newUrls[item.id] = cached.url;
          continue;
        }
        const { data } = await supabase.storage
          .from("org-media")
          .createSignedUrl(item.storage_path, 3600);
        if (data?.signedUrl) {
          newUrls[item.id] = data.signedUrl;
          urlCacheRef.current[item.id] = { url: data.signedUrl, expiresAt: Date.now() + SIGNED_URL_TTL_MS };
        }
      }
      if (!cancelled) {
        setSignedUrls(newUrls);
      }
    }

    if (media.length > 0) {
      generateUrls();
    }

    return () => {
      cancelled = true;
    };
  }, [media.map((m) => m.id).join(",")]);

  const items = media.slice(0, 4);
  const count = items.length;

  if (count === 0) return null;

  if (count === 1) {
    const url = signedUrls[items[0].id];
    return (
      <View style={styles.container}>
        <Image
          source={url}
          style={styles.singleImage}
          contentFit="cover"
          recyclingKey={items[0].id}
          transition={200}
        />
      </View>
    );
  }

  if (count === 2) {
    return (
      <View style={[styles.container, styles.row]}>
        {items.map((item) => (
          <Image
            key={item.id}
            source={signedUrls[item.id]}
            style={styles.halfImage}
            contentFit="cover"
            recyclingKey={item.id}
            transition={200}
          />
        ))}
      </View>
    );
  }

  if (count === 3) {
    return (
      <View style={[styles.container, styles.row]}>
        <Image
          source={signedUrls[items[0].id]}
          style={styles.twoThirdsImage}
          contentFit="cover"
          recyclingKey={items[0].id}
          transition={200}
        />
        <View style={styles.stackedColumn}>
          {items.slice(1).map((item) => (
            <Image
              key={item.id}
              source={signedUrls[item.id]}
              style={styles.stackedImage}
              contentFit="cover"
              recyclingKey={item.id}
              transition={200}
            />
          ))}
        </View>
      </View>
    );
  }

  // 4 images: 2x2 grid
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {items.slice(0, 2).map((item) => (
          <Image
            key={item.id}
            source={signedUrls[item.id]}
            style={styles.quarterImage}
            contentFit="cover"
            recyclingKey={item.id}
            transition={200}
          />
        ))}
      </View>
      <View style={styles.row}>
        {items.slice(2, 4).map((item) => (
          <Image
            key={item.id}
            source={signedUrls[item.id]}
            style={styles.quarterImage}
            contentFit="cover"
            recyclingKey={item.id}
            transition={200}
          />
        ))}
      </View>
    </View>
  );
}

const IMAGE_GAP = SPACING.xs;

const styles = StyleSheet.create({
  container: {
    borderRadius: RADIUS.md,
    overflow: "hidden",
    marginBottom: SPACING.sm,
    gap: IMAGE_GAP,
  },
  row: {
    flexDirection: "row",
    gap: IMAGE_GAP,
  },
  singleImage: {
    width: "100%",
    aspectRatio: 16 / 10,
    borderRadius: RADIUS.md,
  },
  halfImage: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: RADIUS.md,
  },
  twoThirdsImage: {
    flex: 2,
    aspectRatio: 3 / 4,
    borderRadius: RADIUS.md,
  },
  stackedColumn: {
    flex: 1,
    gap: IMAGE_GAP,
  },
  stackedImage: {
    flex: 1,
    borderRadius: RADIUS.md,
  },
  quarterImage: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: RADIUS.md,
  },
});
