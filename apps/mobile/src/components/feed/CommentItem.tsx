import React, { useCallback, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { Image } from "expo-image";
import { Flag, Trash2 } from "lucide-react-native";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatRelativeTime } from "@/lib/date-format";
import type { FeedComment } from "@/types/feed";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { useOrg } from "@/contexts/OrgContext";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { ReportBlockSheet } from "@/components/moderation/ReportBlockSheet";

interface CommentItemProps {
  comment: FeedComment;
  isOwn: boolean;
  isAdmin: boolean;
  onDelete?: (commentId: string) => void;
}

export function CommentItem({ comment, isOwn, isAdmin, onDelete }: CommentItemProps) {
  const { neutral, semantic } = useAppColorScheme();
  const { orgId } = useOrg();
  const [sheetOpen, setSheetOpen] = useState(false);
  const styles = useThemedStyles((n) => ({
    container: {
      flexDirection: "row" as const,
      paddingVertical: SPACING.sm,
      gap: SPACING.sm,
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
    },
    avatarFallback: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: n.border,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    avatarFallbackText: {
      fontSize: 12,
      fontWeight: "600" as const,
      color: n.secondary,
    },
    content: {
      flex: 1,
    },
    headerRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
      marginBottom: 2,
    },
    authorName: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
      fontWeight: "600" as const,
      flex: 1,
    },
    timestamp: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
    body: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    },
  }));

  const handleDelete = useCallback(() => {
    onDelete?.(comment.id);
  }, [onDelete, comment.id]);

  const menuItems = useMemo<OverflowMenuItem[]>(() => {
    const items: OverflowMenuItem[] = [];
    if ((isOwn || isAdmin) && onDelete) {
      items.push({
        id: "delete",
        label: "Delete comment",
        icon: <Trash2 size={18} color={semantic.error} />,
        destructive: true,
        onPress: handleDelete,
      });
    }
    if (!isOwn) {
      items.push({
        id: "report",
        label: "Report comment",
        icon: <Flag size={18} color={neutral.foreground} />,
        onPress: () => setSheetOpen(true),
      });
    }
    return items;
  }, [isOwn, isAdmin, onDelete, handleDelete, neutral.foreground, semantic.error]);

  return (
    <View style={styles.container}>
      {comment.author?.avatar_url ? (
        <Image
          source={comment.author.avatar_url}
          style={styles.avatar}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarFallbackText}>
            {(comment.author?.full_name || "?")[0].toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.authorName} numberOfLines={1}>
            {comment.author?.full_name || "Unknown"}
          </Text>
          <Text style={styles.timestamp}>
            {formatRelativeTime(comment.created_at)}
          </Text>
          {menuItems.length > 0 && (
            <OverflowMenu
              items={menuItems}
              iconSize={16}
              accessibilityLabel="Comment options"
            />
          )}
        </View>
        <Text style={styles.body}>{comment.body}</Text>
      </View>

      <ReportBlockSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        orgId={orgId}
        targetType="feed_comment"
        targetId={comment.id}
        reportedUserId={comment.author_id}
      />
    </View>
  );
}
