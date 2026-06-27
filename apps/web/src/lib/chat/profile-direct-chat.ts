import {
  ensureDirectChatForUser,
  type DirectChatSupabase,
} from "./direct-chat";
import { CHAT_ELIGIBLE_ORG_ROLES } from "./recipient-eligibility";

export type ProfileDirectChatSupabase = DirectChatSupabase;

export type ProfileDirectChatType = "member" | "alumni" | "parent";

export type StartProfileDirectChatResult =
  | {
      ok: true;
      chatGroupId: string;
      reused: boolean;
    }
  | {
      ok: false;
      status: number;
      code:
        | "forbidden"
        | "profile_not_found"
        | "profile_lookup_failed"
        | "profile_inactive"
        | "profile_unlinked"
        | "profile_self"
        | "chat_start_failed";
      error: string;
    };

type ProfileRow = {
  id: string;
  user_id: string | null;
  status?: string | null;
  deleted_at?: string | null;
  open_to_networking?: boolean | null;
};

type LoadProfileUserResult =
  | { profile: ProfileRow | null; error: null }
  | { profile: null; error: "profile_lookup_failed" };

async function loadProfileUser(
  supabase: ProfileDirectChatSupabase,
  input: {
    organizationId: string;
    profileType: ProfileDirectChatType;
    profileId: string;
  },
): Promise<LoadProfileUserResult> {
  if (input.profileType === "member") {
    const { data, error } = await supabase
      .from("members")
      .select("id, user_id, status, deleted_at")
      .eq("id", input.profileId)
      .eq("organization_id", input.organizationId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      console.error("[profile-direct-chat] member profile lookup failed", {
        organizationId: input.organizationId,
        profileId: input.profileId,
        error,
      });
      return { profile: null, error: "profile_lookup_failed" };
    }
    return { profile: (data as ProfileRow | null) ?? null, error: null };
  }

  if (input.profileType === "parent") {
    // Parent messageability is parent-consent-gated: pull open_to_networking so
    // startProfileDirectChat can reject a parent who hasn't opted in.
    const { data, error } = await supabase
      .from("parents")
      .select("id, user_id, deleted_at, open_to_networking")
      .eq("id", input.profileId)
      .eq("organization_id", input.organizationId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      console.error("[profile-direct-chat] parent profile lookup failed", {
        organizationId: input.organizationId,
        profileId: input.profileId,
        error,
      });
      return { profile: null, error: "profile_lookup_failed" };
    }
    return { profile: (data as ProfileRow | null) ?? null, error: null };
  }

  const { data, error } = await supabase
    .from("alumni")
    .select("id, user_id, deleted_at")
    .eq("id", input.profileId)
    .eq("organization_id", input.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[profile-direct-chat] alumni profile lookup failed", {
      organizationId: input.organizationId,
      profileId: input.profileId,
      error,
    });
    return { profile: null, error: "profile_lookup_failed" };
  }
  return { profile: (data as ProfileRow | null) ?? null, error: null };
}

export async function startProfileDirectChat(
  supabase: ProfileDirectChatSupabase,
  input: {
    organizationId: string;
    viewerUserId: string;
    profileType: ProfileDirectChatType;
    profileId: string;
  },
): Promise<StartProfileDirectChatResult> {
  const { data: membership, error: membershipError } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.viewerUserId)
    .eq("status", "active")
    .in("role", CHAT_ELIGIBLE_ORG_ROLES)
    .maybeSingle();

  if (membershipError) {
    console.error("[profile-direct-chat] viewer membership lookup failed", {
      organizationId: input.organizationId,
      viewerUserId: input.viewerUserId,
      error: membershipError,
    });
    return {
      ok: false,
      status: 500,
      code: "profile_lookup_failed",
      error: "Failed to verify chat access.",
    };
  }

  if (!membership) {
    return {
      ok: false,
      status: 403,
      code: "forbidden",
      error: "You must be an active member of this organization to start a chat.",
    };
  }

  const loadedProfile = await loadProfileUser(supabase, input);
  if (loadedProfile.error) {
    return {
      ok: false,
      status: 500,
      code: "profile_lookup_failed",
      error: "Failed to load this profile for chat.",
    };
  }

  const profile = loadedProfile.profile;
  if (!profile) {
    return {
      ok: false,
      status: 404,
      code: "profile_not_found",
      error: "Profile not found.",
    };
  }

  if (input.profileType === "member" && profile.status !== "active") {
    return {
      ok: false,
      status: 409,
      code: "profile_inactive",
      error: "This member profile is not available for in-app chat.",
    };
  }

  // A parent is only messageable if they consented via open_to_networking. This
  // re-checks server-side (the candidate query already filters it, but the
  // Message action must not trust the client-supplied profileId).
  if (input.profileType === "parent" && profile.open_to_networking !== true) {
    return {
      ok: false,
      status: 409,
      code: "profile_inactive",
      error: "This parent is not available for networking.",
    };
  }

  if (!profile.user_id) {
    return {
      ok: false,
      status: 409,
      code: "profile_unlinked",
      error: "This profile is not linked to an in-app user account.",
    };
  }

  if (profile.user_id === input.viewerUserId) {
    return {
      ok: false,
      status: 409,
      code: "profile_self",
      error: "You cannot start a direct chat with yourself.",
    };
  }

  const chat = await ensureDirectChatForUser(supabase, {
    organizationId: input.organizationId,
    senderUserId: input.viewerUserId,
    recipientUserId: profile.user_id,
  });

  if (!chat.ok) {
    return {
      ok: false,
      status: chat.status,
      code: "chat_start_failed",
      error: chat.error,
    };
  }

  return {
    ok: true,
    chatGroupId: chat.chatGroupId,
    reused: chat.reused,
  };
}
