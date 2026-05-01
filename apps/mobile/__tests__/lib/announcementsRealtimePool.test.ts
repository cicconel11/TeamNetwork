/**
 * Ensures pooled Supabase realtime subscriptions do not double-register
 * postgres_changes handlers on the same channel name (throws after subscribe()).
 */

const mockChannelBuilder = {
  on: jest.fn().mockReturnThis(),
  subscribe: jest.fn().mockReturnThis(),
};

jest.mock("@/lib/supabase", () => ({
  supabase: {
    channel: jest.fn(() => mockChannelBuilder),
    removeChannel: jest.fn(),
  },
}));

import {
  subscribeAnnouncementsPostgresChanges,
  subscribeUnreadAnnouncementsRealtime,
} from "../../src/lib/announcementsRealtimePool";
import { supabase } from "@/lib/supabase";

describe("announcementsRealtimePool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.channel as jest.Mock).mockReturnValue(mockChannelBuilder);
  });

  it("creates one channel for multiple announcements table subscribers (same org)", () => {
    const u1 = subscribeAnnouncementsPostgresChanges("org-a", jest.fn());
    const u2 = subscribeAnnouncementsPostgresChanges("org-a", jest.fn());
    expect(supabase.channel).toHaveBeenCalledTimes(1);
    expect(supabase.channel).toHaveBeenCalledWith("announcements:org-a");
    u1();
    expect(supabase.removeChannel).not.toHaveBeenCalled();
    u2();
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("creates one channel for duplicate unread-announcements hook mounts (same org + user)", () => {
    const u1 = subscribeUnreadAnnouncementsRealtime("org-b", "user-1", jest.fn());
    const u2 = subscribeUnreadAnnouncementsRealtime("org-b", "user-1", jest.fn());
    expect(supabase.channel).toHaveBeenCalledTimes(1);
    expect(supabase.channel).toHaveBeenCalledWith("unread-announcements:org-b:user-1");
    expect(mockChannelBuilder.on).toHaveBeenCalledTimes(2);
    u1();
    expect(supabase.removeChannel).not.toHaveBeenCalled();
    u2();
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  });
});
