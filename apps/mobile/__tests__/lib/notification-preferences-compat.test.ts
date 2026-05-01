import {
  isMissingPerCategoryPushPreferenceColumnsError,
  LEGACY_NOTIFICATION_PREF_SELECT_COLUMNS,
} from "@/lib/notification-preferences-compat";

describe("notification-preferences-compat", () => {
  it("exposes legacy select list without per-category push columns", () => {
    expect(LEGACY_NOTIFICATION_PREF_SELECT_COLUMNS).toBe(
      "id,email_address,email_enabled,push_enabled"
    );
    expect(LEGACY_NOTIFICATION_PREF_SELECT_COLUMNS).not.toContain("announcement_push_enabled");
  });

  it("detects PostgREST undefined column errors for push preference fields", () => {
    const err = {
      message:
        "column notification_preferences.announcement_push_enabled does not exist",
    };
    expect(isMissingPerCategoryPushPreferenceColumnsError(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isMissingPerCategoryPushPreferenceColumnsError(null)).toBe(false);
    expect(isMissingPerCategoryPushPreferenceColumnsError({ message: "JWT expired" })).toBe(
      false
    );
    expect(
      isMissingPerCategoryPushPreferenceColumnsError({
        message: "column foo.bar does not exist",
      })
    ).toBe(false);
  });
});
