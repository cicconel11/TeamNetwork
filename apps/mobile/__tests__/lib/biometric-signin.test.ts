import type { Session } from "@supabase/supabase-js";

const ENABLED_KEY = "teammeet.biometric_enabled.v1";
const SESSION_KEY = "teammeet.biometric_session.v1";
const MARKER_KEY = "teammeet.biometric_session_available.v1";

function futureExpiry(secondsFromNow = 3600): number {
  return Math.floor(Date.now() / 1000) + secondsFromNow;
}

function storedBiometricSession(expiresAt?: number): string {
  return JSON.stringify({
    access_token: "stored-access",
    refresh_token: "stored-refresh",
    user_id: "user-1",
    saved_at: "2026-06-29T00:00:00.000Z",
    ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
  });
}

function mockBiometricSignInModules({
  enabled = "1",
  marker = "1",
  protectedSession,
  setSessionError = null,
}: {
  enabled?: string | null;
  marker?: string | null;
  protectedSession?: string | null;
  setSessionError?: { message: string } | null;
} = {}) {
  jest.resetModules();

  const getItemAsync = jest.fn((key: string) => {
    if (key === ENABLED_KEY) return Promise.resolve(enabled);
    if (key === MARKER_KEY) return Promise.resolve(marker);
    if (key === SESSION_KEY) return Promise.resolve(protectedSession ?? null);
    return Promise.resolve(null);
  });
  const setItemAsync = jest.fn().mockResolvedValue(undefined);
  const deleteItemAsync = jest.fn().mockResolvedValue(undefined);
  const canUseBiometricAuthentication = jest.fn().mockReturnValue(true);
  const hasHardwareAsync = jest.fn().mockResolvedValue(true);
  const isEnrolledAsync = jest.fn().mockResolvedValue(true);
  const authenticateAsync = jest.fn().mockResolvedValue({ success: true });
  const setSession = jest.fn().mockResolvedValue({
    data: {
      session: {
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_at: 123,
        user: { id: "user-1" },
      },
    },
    error: setSessionError,
  });

  jest.doMock("react-native", () => ({
    Platform: { OS: "ios" },
  }));
  jest.doMock("expo-secure-store", () => ({
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
    canUseBiometricAuthentication,
    getItemAsync,
    setItemAsync,
    deleteItemAsync,
  }));
  jest.doMock("expo-local-authentication", () => ({
    hasHardwareAsync,
    isEnrolledAsync,
    authenticateAsync,
  }));
  jest.doMock("@/lib/supabase", () => ({
    supabase: {
      auth: {
        setSession,
      },
    },
  }));

  const module = require("../../src/lib/biometric-signin");
  return {
    module,
    secureStore: { getItemAsync, setItemAsync, deleteItemAsync, canUseBiometricAuthentication },
    localAuth: { hasHardwareAsync, isEnrolledAsync, authenticateAsync },
    supabaseAuth: { setSession },
  };
}

describe("biometric sign-in", () => {
  afterEach(() => {
    jest.dontMock("react-native");
    jest.dontMock("expo-secure-store");
    jest.dontMock("expo-local-authentication");
    jest.dontMock("@/lib/supabase");
    jest.clearAllMocks();
  });

  it("does not show biometric sign-in without a stored credential marker", async () => {
    const { module } = mockBiometricSignInModules({ marker: null });

    await expect(module.canShowBiometricSignIn()).resolves.toBe(false);
  });

  it("restores a protected session through Supabase after biometric authentication", async () => {
    const { module, secureStore, supabaseAuth } = mockBiometricSignInModules({
      protectedSession: storedBiometricSession(futureExpiry()),
    });

    await expect(module.signInWithBiometrics()).resolves.toEqual({ success: true });

    expect(secureStore.getItemAsync).toHaveBeenCalledWith(
      SESSION_KEY,
      expect.objectContaining({
        requireAuthentication: true,
        authenticationPrompt: "Sign in to TeamNetwork",
      })
    );
    expect(supabaseAuth.setSession).toHaveBeenCalledWith({
      access_token: "stored-access",
      refresh_token: "stored-refresh",
    });
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      SESSION_KEY,
      expect.stringContaining("new-refresh"),
      expect.objectContaining({ requireAuthentication: true })
    );
  });

  it("clears biometric sign-in when the protected credential is missing", async () => {
    const { module, secureStore, supabaseAuth } = mockBiometricSignInModules({
      protectedSession: null,
    });

    await expect(module.signInWithBiometrics()).resolves.toMatchObject({
      success: false,
      expired: true,
    });

    expect(supabaseAuth.setSession).not.toHaveBeenCalled();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      SESSION_KEY,
      expect.objectContaining({ requireAuthentication: true })
    );
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(ENABLED_KEY);
  });

  it("clears biometric sign-in when the stored session is expired", async () => {
    const { module, secureStore, supabaseAuth } = mockBiometricSignInModules({
      protectedSession: storedBiometricSession(futureExpiry(-1)),
    });

    await expect(module.signInWithBiometrics()).resolves.toMatchObject({
      success: false,
      expired: true,
    });

    expect(supabaseAuth.setSession).not.toHaveBeenCalled();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      SESSION_KEY,
      expect.objectContaining({ requireAuthentication: true })
    );
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(ENABLED_KEY);
  });

  it("clears biometric sign-in when the stored session has no expiry metadata", async () => {
    const { module, secureStore, supabaseAuth } = mockBiometricSignInModules({
      protectedSession: storedBiometricSession(),
    });

    await expect(module.signInWithBiometrics()).resolves.toMatchObject({
      success: false,
      expired: true,
    });

    expect(supabaseAuth.setSession).not.toHaveBeenCalled();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      SESSION_KEY,
      expect.objectContaining({ requireAuthentication: true })
    );
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(ENABLED_KEY);
  });

  it("clears biometric sign-in when the stored session expires inside the refresh skew window", async () => {
    const { module, secureStore, supabaseAuth } = mockBiometricSignInModules({
      protectedSession: storedBiometricSession(futureExpiry(10)),
    });

    await expect(module.signInWithBiometrics()).resolves.toMatchObject({
      success: false,
      expired: true,
    });

    expect(supabaseAuth.setSession).not.toHaveBeenCalled();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      SESSION_KEY,
      expect.objectContaining({ requireAuthentication: true })
    );
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(ENABLED_KEY);
  });

  it("clears biometric sign-in when Supabase rejects a future-dated stored session", async () => {
    const { module, secureStore, supabaseAuth } = mockBiometricSignInModules({
      protectedSession: storedBiometricSession(futureExpiry()),
      setSessionError: { message: "Invalid Refresh Token" },
    });

    await expect(module.signInWithBiometrics()).resolves.toMatchObject({
      success: false,
      expired: true,
    });

    expect(supabaseAuth.setSession).toHaveBeenCalledWith({
      access_token: "stored-access",
      refresh_token: "stored-refresh",
    });
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      SESSION_KEY,
      expect.objectContaining({ requireAuthentication: true })
    );
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(ENABLED_KEY);
  });

  it("requires a current session and stores it in a biometric-protected SecureStore item", async () => {
    const currentSession = {
      access_token: "current-access",
      refresh_token: "current-refresh",
      expires_at: 123,
      user: { id: "user-1" },
    } as Session;
    const { module, secureStore, localAuth } = mockBiometricSignInModules();

    await expect(module.enableBiometricSignIn(currentSession)).resolves.toEqual({ success: true });

    expect(localAuth.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ promptMessage: "Enable Face ID for TeamNetwork" })
    );
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      SESSION_KEY,
      expect.stringContaining("current-refresh"),
      expect.objectContaining({ requireAuthentication: true })
    );
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(MARKER_KEY, "1", expect.any(Object));
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(ENABLED_KEY, "1");
  });
});
