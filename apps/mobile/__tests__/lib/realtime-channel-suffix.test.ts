import { createRealtimeChannelSuffix } from "@/lib/realtime-channel-suffix";

describe("createRealtimeChannelSuffix", () => {
  it("returns non-empty strings", () => {
    const a = createRealtimeChannelSuffix();
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
  });

  it("returns distinct values when invoked twice", () => {
    const a = createRealtimeChannelSuffix();
    const b = createRealtimeChannelSuffix();
    expect(a).not.toBe(b);
  });
});
