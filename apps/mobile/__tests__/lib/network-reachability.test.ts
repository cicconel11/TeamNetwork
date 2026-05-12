import { NetworkUnreachableError } from "@/lib/web-api";
import { isExpectedClientNetworkFailure } from "@/lib/network-reachability";

describe("isExpectedClientNetworkFailure", () => {
  it("returns true for NetworkUnreachableError", () => {
    expect(isExpectedClientNetworkFailure(new NetworkUnreachableError())).toBe(true);
    expect(isExpectedClientNetworkFailure(new NetworkUnreachableError("Network unreachable"))).toBe(
      true
    );
  });

  it("returns true for common fetch failure messages", () => {
    expect(isExpectedClientNetworkFailure(new TypeError("Network request failed"))).toBe(true);
    expect(isExpectedClientNetworkFailure(new Error("TypeError: Network request failed"))).toBe(
      true
    );
    expect(isExpectedClientNetworkFailure(new Error("Failed to fetch"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isExpectedClientNetworkFailure(new Error("Not authenticated"))).toBe(false);
    expect(isExpectedClientNetworkFailure(null)).toBe(false);
    expect(isExpectedClientNetworkFailure("string")).toBe(false);
  });
});
