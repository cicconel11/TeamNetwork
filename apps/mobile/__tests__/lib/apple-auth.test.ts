import {
  APPLE_AUTH_CANCELED_CODE,
  isAppleAuthAvailable,
  isAppleAuthCanceled,
  signInWithApple,
  signUpWithApple,
} from "@/lib/apple-auth";
import { captureException } from "@/lib/analytics";
import { supabase } from "@/lib/supabase";
import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";

jest.mock("expo-apple-authentication", () => ({
  AppleAuthenticationScope: {
    FULL_NAME: 0,
    EMAIL: 1,
  },
  isAvailableAsync: jest.fn(),
  signInAsync: jest.fn(),
  formatFullName: jest.fn((fullName) =>
    [fullName.givenName, fullName.middleName, fullName.familyName].filter(Boolean).join(" ")
  ),
}));

jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: {
    SHA256: "SHA-256",
  },
  randomUUID: jest.fn(() => "raw-nonce"),
  digestStringAsync: jest.fn(() => Promise.resolve("hashed-nonce")),
}));

jest.mock("@/lib/analytics", () => ({
  captureException: jest.fn(),
}));

const auth = supabase.auth as jest.Mocked<typeof supabase.auth> & {
  signInWithIdToken: jest.Mock;
  updateUser: jest.Mock;
};

describe("apple-auth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = "ios";
    jest.mocked(Crypto.randomUUID).mockReturnValue("raw-nonce");
    jest.mocked(Crypto.digestStringAsync).mockResolvedValue("hashed-nonce");
    jest.mocked(AppleAuthentication.formatFullName).mockImplementation((fullName) =>
      [fullName.givenName, fullName.middleName, fullName.familyName].filter(Boolean).join(" ")
    );
    auth.signInWithIdToken = jest.fn().mockResolvedValue({
      data: { session: { access_token: "access-token" }, user: { id: "user-1" } },
      error: null,
    });
    auth.updateUser = jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    auth.signOut = jest.fn().mockResolvedValue({ error: null });
  });

  it("reports unavailable outside iOS", async () => {
    Platform.OS = "android";

    await expect(isAppleAuthAvailable()).resolves.toBe(false);
    expect(AppleAuthentication.isAvailableAsync).not.toHaveBeenCalled();
  });

  it("reports native availability on iOS", async () => {
    jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(true);

    await expect(isAppleAuthAvailable()).resolves.toBe(true);
  });

  it("captures availability errors and fails closed", async () => {
    const error = new Error("native unavailable");
    jest.mocked(AppleAuthentication.isAvailableAsync).mockRejectedValue(error);

    await expect(isAppleAuthAvailable()).resolves.toBe(false);
    expect(captureException).toHaveBeenCalledWith(error, { context: "isAppleAuthAvailable" });
  });

  it("identifies user-canceled Apple auth errors", () => {
    expect(isAppleAuthCanceled({ code: APPLE_AUTH_CANCELED_CODE })).toBe(true);
    expect(isAppleAuthCanceled(new Error("failed"))).toBe(false);
  });

  it("signs in with the Apple identity token and raw nonce", async () => {
    jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      user: "apple-user",
      state: null,
      fullName: null,
      email: "user@example.com",
      realUserStatus: 2,
      identityToken: "identity-token",
      authorizationCode: "auth-code",
    });

    await signInWithApple();

    expect(Crypto.digestStringAsync).toHaveBeenCalledWith("SHA-256", "raw-nonce");
    expect(AppleAuthentication.signInAsync).toHaveBeenCalledWith({
      requestedScopes: [0, 1],
      nonce: "hashed-nonce",
    });
    expect(auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: "apple",
      token: "identity-token",
      nonce: "raw-nonce",
    });
  });

  it("throws a friendly error when Apple omits the identity token", async () => {
    jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      user: "apple-user",
      state: null,
      fullName: null,
      email: null,
      realUserStatus: 1,
      identityToken: null,
      authorizationCode: null,
    });

    await expect(signInWithApple()).rejects.toThrow(
      "Apple did not return an identity token. Please try again."
    );
    expect(auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it("persists first-login Apple name metadata", async () => {
    jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      user: "apple-user",
      state: null,
      fullName: {
        namePrefix: null,
        givenName: "Avery",
        middleName: null,
        familyName: "Stone",
        nameSuffix: null,
        nickname: null,
      },
      email: "avery@example.com",
      realUserStatus: 2,
      identityToken: "identity-token",
      authorizationCode: "auth-code",
    });

    await signInWithApple();

    expect(auth.updateUser).toHaveBeenCalledWith({
      data: {
        full_name: "Avery Stone",
        name: "Avery Stone",
        given_name: "Avery",
        first_name: "Avery",
        family_name: "Stone",
        last_name: "Stone",
      },
    });
  });

  it("persists signup age metadata after Apple auth succeeds", async () => {
    jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      user: "apple-user",
      state: null,
      fullName: null,
      email: "teen@example.com",
      realUserStatus: 2,
      identityToken: "identity-token",
      authorizationCode: "auth-code",
    });

    await signUpWithApple({
      ageBracket: "13_17",
      isMinor: true,
      token: "age-token",
    });

    expect(auth.updateUser).toHaveBeenCalledWith({
      data: {
        age_bracket: "13_17",
        is_minor: true,
        age_validation_token: "age-token",
      },
    });
  });

  it("captures non-fatal metadata update failures", async () => {
    jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      user: "apple-user",
      state: null,
      fullName: {
        namePrefix: null,
        givenName: "Avery",
        middleName: null,
        familyName: "Stone",
        nameSuffix: null,
        nickname: null,
      },
      email: "avery@example.com",
      realUserStatus: 2,
      identityToken: "identity-token",
      authorizationCode: "auth-code",
    });
    auth.updateUser.mockResolvedValue({ data: null, error: { message: "metadata failed" } });

    await expect(signInWithApple()).resolves.toBeDefined();
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      context: "authenticateWithApple.updateUser",
    });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("fails Apple signup when age metadata cannot be saved", async () => {
    jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      user: "apple-user",
      state: null,
      fullName: null,
      email: "teen@example.com",
      realUserStatus: 2,
      identityToken: "identity-token",
      authorizationCode: "auth-code",
    });
    auth.updateUser.mockResolvedValue({ data: null, error: { message: "metadata failed" } });

    await expect(
      signUpWithApple({
        ageBracket: "13_17",
        isMinor: true,
        token: "age-token",
      })
    ).rejects.toThrow("Could not save age verification. Please try again.");
    expect(auth.signOut).toHaveBeenCalled();
  });
});
