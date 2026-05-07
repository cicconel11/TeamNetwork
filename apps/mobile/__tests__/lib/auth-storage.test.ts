describe("nativeSecureAuthStorage", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("stores Supabase auth state in expo-secure-store on native platforms", async () => {
    const getItemAsync = jest.fn().mockResolvedValue("stored-session");
    const setItemAsync = jest.fn().mockResolvedValue(undefined);
    const deleteItemAsync = jest.fn().mockResolvedValue(undefined);

    jest.doMock("react-native", () => ({
      Platform: { OS: "ios" },
    }));
    jest.doMock("expo-secure-store", () => ({
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
      getItemAsync,
      setItemAsync,
      deleteItemAsync,
    }));

    const {
      nativeSecureAuthStorage,
      SECURE_AUTH_STORAGE_OPTIONS,
    } = require("../../src/lib/auth-storage");

    await nativeSecureAuthStorage.setItem("supabase.auth.token", "session-value");
    await nativeSecureAuthStorage.getItem("supabase.auth.token");
    await nativeSecureAuthStorage.removeItem("supabase.auth.token");

    expect(setItemAsync).toHaveBeenCalledWith(
      "teammeet.auth.supabase.auth.token",
      "session-value",
      SECURE_AUTH_STORAGE_OPTIONS
    );
    expect(getItemAsync).toHaveBeenCalledWith(
      "teammeet.auth.supabase.auth.token",
      SECURE_AUTH_STORAGE_OPTIONS
    );
    expect(deleteItemAsync).toHaveBeenCalledWith(
      "teammeet.auth.supabase.auth.token",
      SECURE_AUTH_STORAGE_OPTIONS
    );
  });
});
