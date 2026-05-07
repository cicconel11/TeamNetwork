import type { Database } from "@/types/database";
import type { MediaAttachment } from "@/lib/media/fetch";

export type PollMetadata = {
  question: string;
  options: { label: string }[];
  allow_change: boolean;
};

export type PostWithAuthor = Database["public"]["Tables"]["feed_posts"]["Row"] & {
  author: { name: string } | null;
  liked_by_user: boolean;
  media?: MediaAttachment[];
  // Poll augmentation (set by server for poll-type posts)
  poll_meta?: PollMetadata | null;
  user_vote?: number | null;
  vote_counts?: number[];
  total_votes?: number;
};

export type CommentWithAuthor = Database["public"]["Tables"]["feed_comments"]["Row"] & {
  author: { name: string } | null;
};
