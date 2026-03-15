import type { Database } from "@teammeet/types";

/** Raw feed_posts row from Supabase */
type FeedPostRow = Database["public"]["Tables"]["feed_posts"]["Row"];

/** Author shape returned from the users join */
export interface PostAuthor {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

/** Media attachment from media_uploads join */
export interface MediaAttachment {
  id: string;
  storage_path: string;
  mime_type: string;
  file_name: string;
  signedUrl?: string;
}

/** Post with author, like status, and media — the hook's return type */
export interface FeedPost extends FeedPostRow {
  author: PostAuthor | null;
  liked_by_user: boolean;
  media: MediaAttachment[];
}

/** Raw feed_comments row from Supabase */
type FeedCommentRow = Database["public"]["Tables"]["feed_comments"]["Row"];

/** Comment with author join */
export interface FeedComment extends FeedCommentRow {
  author: PostAuthor | null;
}

/** Return type for useFeed hook */
export interface UseFeedReturn {
  posts: FeedPost[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  totalCount: number | null;
  pendingPosts: FeedPost[];
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
  acceptPendingPosts: () => void;
  createPost: (body: string) => Promise<void>;
  updatePost: (postId: string, body: string) => Promise<void>;
  deletePost: (postId: string) => Promise<void>;
  toggleLike: (postId: string) => Promise<void>;
}

/** Return type for usePost hook */
export interface UsePostReturn {
  post: FeedPost | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Return type for useComments hook */
export interface UseCommentsReturn {
  comments: FeedComment[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createComment: (body: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
}
