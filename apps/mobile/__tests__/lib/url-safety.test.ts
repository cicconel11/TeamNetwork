import * as Linking from "expo-linking";
import {
  openEmailAddress,
  openHttpsUrl,
  openPhoneNumber,
} from "../../src/lib/url-safety";

const canOpenURL = Linking.canOpenURL as jest.Mock;
const openURL = Linking.openURL as jest.Mock;

describe("url-safety openers", () => {
  beforeEach(() => {
    canOpenURL.mockReset().mockResolvedValue(true);
    openURL.mockReset().mockResolvedValue(undefined);
  });

  describe("openEmailAddress", () => {
    it("opens a valid, url-encoded mailto: link when supported", async () => {
      await expect(openEmailAddress("Lociccone11@gmail.com")).resolves.toBe(true);
      expect(canOpenURL).toHaveBeenCalledWith(
        `mailto:${encodeURIComponent("lociccone11@gmail.com")}`
      );
      expect(openURL).toHaveBeenCalledWith(
        `mailto:${encodeURIComponent("lociccone11@gmail.com")}`
      );
    });

    it("returns false without opening when the address is invalid", async () => {
      await expect(openEmailAddress("not-an-email")).resolves.toBe(false);
      expect(canOpenURL).not.toHaveBeenCalled();
      expect(openURL).not.toHaveBeenCalled();
    });

    it("returns false when the OS cannot open the link (no Mail app)", async () => {
      canOpenURL.mockResolvedValue(false);
      await expect(openEmailAddress("lociccone11@gmail.com")).resolves.toBe(false);
      expect(openURL).not.toHaveBeenCalled();
    });

    it("swallows an openURL rejection instead of throwing", async () => {
      openURL.mockRejectedValue(
        new Error("Unable to open URL: mailto:lociccone11@gmail.com")
      );
      await expect(openEmailAddress("lociccone11@gmail.com")).resolves.toBe(false);
    });
  });

  describe("openHttpsUrl", () => {
    it("returns false when the OS cannot open the link", async () => {
      canOpenURL.mockResolvedValue(false);
      await expect(openHttpsUrl("https://example.com")).resolves.toBe(false);
      expect(openURL).not.toHaveBeenCalled();
    });

    it("rejects non-https schemes", async () => {
      await expect(openHttpsUrl("javascript:alert(1)")).resolves.toBe(false);
      expect(canOpenURL).not.toHaveBeenCalled();
    });
  });

  describe("openPhoneNumber", () => {
    it("opens a tel: link when supported", async () => {
      await expect(openPhoneNumber("555-123-4567")).resolves.toBe(true);
      expect(openURL).toHaveBeenCalledWith(`tel:${encodeURIComponent("555-123-4567")}`);
    });

    it("returns false for an empty number", async () => {
      await expect(openPhoneNumber("   ")).resolves.toBe(false);
      expect(canOpenURL).not.toHaveBeenCalled();
    });
  });
});
