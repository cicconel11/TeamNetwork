/**
 * Native share-sheet wrappers.
 *
 * Each helper builds a canonical web URL via `getWebPath` so recipients without
 * the app installed land on the web equivalent. Universal Links from P0b cause
 * recipients with the app installed to deep-link straight in.
 *
 * Uses React Native's built-in `Share.share` for URL/text payloads (no extra
 * dep needed). `expo-sharing` is reserved for file payloads (e.g. `.pkpass` in
 * P3 wallet work).
 */

import { Share, type ShareContent, type ShareOptions } from "react-native";
import { captureException } from "@/lib/analytics";
import { getWebAppUrl, getWebPath } from "@/lib/web-api";
import { getInviteLink, type Invite } from "@/hooks/useInvites";

interface ShareResult {
  /** True if the user completed any share action (or, on iOS, dismissed the sheet — Apple does not differentiate). */
  shared: boolean;
}

async function shareSafely(
  content: ShareContent,
  context: string,
  options?: ShareOptions
): Promise<ShareResult> {
  try {
    const result = await Share.share(content, options);
    return { shared: result.action === Share.sharedAction };
  } catch (err) {
    captureException(err as Error, { context: `share.${context}` });
    return { shared: false };
  }
}

export async function shareInvite(invite: Invite): Promise<ShareResult> {
  const url = getInviteLink(invite, getWebAppUrl());
  return shareSafely(
    {
      url,
      message: `Join my organization on TeamMeet: ${url}`,
    },
    "invite"
  );
}

export interface ShareEventInput {
  id: string;
  title: string;
  orgSlug: string;
}

export async function shareEvent(event: ShareEventInput): Promise<ShareResult> {
  const url = getWebPath(event.orgSlug, `events/${event.id}`);
  return shareSafely(
    { url, message: `${event.title} — ${url}` },
    "event"
  );
}

export interface ShareJobInput {
  id: string;
  title: string;
  orgSlug: string;
}

export async function shareJob(job: ShareJobInput): Promise<ShareResult> {
  const url = getWebPath(job.orgSlug, `jobs/${job.id}`);
  return shareSafely(
    { url, message: `${job.title} — ${url}` },
    "job"
  );
}

export interface SharePostInput {
  id: string;
  /** Plain-text excerpt used as a share preview. */
  excerpt?: string;
  orgSlug: string;
}

export async function sharePost(post: SharePostInput): Promise<ShareResult> {
  const url = getWebPath(post.orgSlug, `feed/${post.id}`);
  const excerpt = post.excerpt?.trim();
  return shareSafely(
    {
      url,
      message: excerpt ? `${excerpt}\n\n${url}` : url,
    },
    "post"
  );
}

/**
 * Generic URL share. Used by callers that already have a fully-built link.
 */
export async function shareUrl(url: string, message?: string): Promise<ShareResult> {
  return shareSafely(
    { url, message: message ?? url },
    "url"
  );
}
