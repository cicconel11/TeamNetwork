import { generateRealtimeChannelInstanceSuffix } from "@/lib/realtime-instance-id";

describe("generateRealtimeChannelInstanceSuffix", () => {
  it("returns a non-empty string", () => {
    const s = generateRealtimeChannelInstanceSuffix();
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(4);
  });

  it("returns distinct values across calls (high probability)", () => {
    const a = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      a.add(generateRealtimeChannelInstanceSuffix());
    }
    expect(a.size).toBe(20);
  });
});
