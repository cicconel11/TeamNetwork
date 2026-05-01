import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Supabase returns the same RealtimeChannel instance for a given channel name.
 * Multiple hooks must not each call .on().subscribe() on that name — the second
 * .on() runs after subscribe() and throws. These pools keep one channel per key
 * and fan out events to all subscribers.
 */

type VoidCb = () => void;

type AnnouncementsPool = {
  listeners: Set<VoidCb>;
  channel: RealtimeChannel | null;
};

type RolesPool = {
  listeners: Set<VoidCb>;
  channel: RealtimeChannel | null;
  orgId: string;
  userId: string | null;
};

const announcementsByOrg = new Map<string, AnnouncementsPool>();
/** Tab layout + announcements screen both mount useUnreadAnnouncementCount — same channel name. */
const unreadAnnouncementsPoolByKey = new Map<
  string,
  { listeners: Set<VoidCb>; channel: RealtimeChannel | null; orgId: string; userId: string | null }
>();
const rolesByKey = new Map<string, RolesPool>();

function getAnnouncementsPool(orgId: string): AnnouncementsPool {
  let pool = announcementsByOrg.get(orgId);
  if (!pool) {
    pool = { listeners: new Set(), channel: null };
    announcementsByOrg.set(orgId, pool);
  }
  return pool;
}

function ensureAnnouncementsChannel(pool: AnnouncementsPool, orgId: string): void {
  if (pool.channel) return;

  pool.channel = supabase
    .channel(`announcements:${orgId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "announcements",
        filter: `organization_id=eq.${orgId}`,
      },
      () => {
        pool.listeners.forEach((fn) => {
          fn();
        });
      }
    )
    .subscribe();
}

export function subscribeAnnouncementsPostgresChanges(
  orgId: string,
  onChange: VoidCb
): () => void {
  const pool = getAnnouncementsPool(orgId);
  pool.listeners.add(onChange);
  ensureAnnouncementsChannel(pool, orgId);

  return () => {
    pool.listeners.delete(onChange);
    if (pool.listeners.size === 0 && pool.channel) {
      supabase.removeChannel(pool.channel);
      pool.channel = null;
      announcementsByOrg.delete(orgId);
    }
  };
}

function unreadPoolKey(orgId: string, userId: string | null): string {
  return `${orgId}:${userId ?? ""}`;
}

export function subscribeUnreadAnnouncementsRealtime(
  orgId: string,
  userId: string | null,
  onChange: VoidCb
): () => void {
  const key = unreadPoolKey(orgId, userId);
  let pool = unreadAnnouncementsPoolByKey.get(key);
  if (!pool) {
    pool = { listeners: new Set(), channel: null, orgId, userId };
    unreadAnnouncementsPoolByKey.set(key, pool);
  }

  pool.listeners.add(onChange);

  if (!pool.channel) {
    const { orgId: oid, userId: uid } = pool;
    pool.channel = supabase
      .channel(`unread-announcements:${key}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "announcements",
          filter: `organization_id=eq.${oid}`,
        },
        () => {
          pool!.listeners.forEach((fn) => {
            fn();
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_organization_roles",
          filter: uid ? `user_id=eq.${uid}` : undefined,
        },
        (payload: {
          new?: { organization_id?: string } | null;
          old?: { organization_id?: string } | null;
        }) => {
          const nextOrgId = (payload.new as { organization_id?: string } | null)?.organization_id;
          const previousOrgId = (payload.old as { organization_id?: string } | null)?.organization_id;
          if (nextOrgId === oid || previousOrgId === oid) {
            pool!.listeners.forEach((fn) => {
              fn();
            });
          }
        }
      )
      .subscribe();
  }

  return () => {
    pool!.listeners.delete(onChange);
    if (pool!.listeners.size === 0 && pool!.channel) {
      supabase.removeChannel(pool!.channel);
      pool!.channel = null;
      unreadAnnouncementsPoolByKey.delete(key);
    }
  };
}

function rolesPoolKey(orgId: string, userId: string | null): string {
  return `${orgId}:${userId ?? ""}`;
}

function ensureRolesChannel(pool: RolesPool, key: string): void {
  if (pool.channel) return;

  const { orgId, userId } = pool;
  pool.channel = supabase
    .channel(`announcement-roles:${key}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "user_organization_roles",
        filter: userId ? `user_id=eq.${userId}` : undefined,
      },
      (payload: {
        new?: { organization_id?: string } | null;
        old?: { organization_id?: string } | null;
      }) => {
        const nextOrgId = (payload.new as { organization_id?: string } | null)?.organization_id;
        const previousOrgId = (payload.old as { organization_id?: string } | null)?.organization_id;
        if (nextOrgId === orgId || previousOrgId === orgId) {
          pool.listeners.forEach((fn) => {
            fn();
          });
        }
      }
    )
    .subscribe();
}

export function subscribeAnnouncementRolesForOrgUser(
  orgId: string,
  userId: string | null,
  onChange: VoidCb
): () => void {
  const key = rolesPoolKey(orgId, userId);
  let pool = rolesByKey.get(key);
  if (!pool) {
    pool = { listeners: new Set(), channel: null, orgId, userId };
    rolesByKey.set(key, pool);
  }
  pool.listeners.add(onChange);
  ensureRolesChannel(pool, key);

  return () => {
    pool!.listeners.delete(onChange);
    if (pool!.listeners.size === 0 && pool!.channel) {
      supabase.removeChannel(pool!.channel);
      pool!.channel = null;
      rolesByKey.delete(key);
    }
  };
}
