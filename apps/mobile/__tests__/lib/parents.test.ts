jest.mock("expo/virtual/env", () => ({
  env: {},
}), { virtual: true });

import {
  INITIAL_PARENT_FORM_VALUES,
  buildParentInviteLink,
  buildParentPayload,
  getParentDisplayName,
  getParentInitials,
  isParentInvitePending,
  validateParentForm,
} from "../../src/lib/parents";

describe("mobile parent helpers", () => {
  it("formats display names and initials", () => {
    const parent = {
      first_name: "Pat",
      last_name: "Parent",
      email: "pat@example.com",
    };

    expect(getParentDisplayName(parent)).toBe("Pat Parent");
    expect(getParentInitials(parent)).toBe("PP");
  });

  it("normalizes optional fields into a request payload", () => {
    const payload = buildParentPayload({
      ...INITIAL_PARENT_FORM_VALUES,
      first_name: "Pat",
      last_name: "Parent",
      email: "",
      relationship: "Guardian",
      student_name: "Casey Student",
    });

    expect(payload).toEqual({
      first_name: "Pat",
      last_name: "Parent",
      email: null,
      phone_number: null,
      linkedin_url: null,
      student_name: "Casey Student",
      relationship: "Guardian",
      notes: null,
    });
  });

  it("validates required fields and LinkedIn URLs", () => {
    expect(
      validateParentForm({
        ...INITIAL_PARENT_FORM_VALUES,
        first_name: "Pat",
        last_name: "Parent",
        linkedin_url: "https://linkedin.com/in/pat-parent",
      })
    ).toBeNull();

    expect(
      validateParentForm({
        ...INITIAL_PARENT_FORM_VALUES,
        first_name: "Pat",
        last_name: "",
      })
    ).toContain("Last name");

    expect(
      validateParentForm({
        ...INITIAL_PARENT_FORM_VALUES,
        first_name: "Pat",
        last_name: "Parent",
        linkedin_url: "https://example.com/not-linkedin",
      })
    ).toContain("LinkedIn");
  });

  it("builds parent invite links and invite status", () => {
    const link = buildParentInviteLink("org-123", "ABC123");
    expect(link).toContain("/app/parents-join?");
    expect(link).toContain("org=org-123");
    expect(link).toContain("code=ABC123");

    expect(
      isParentInvitePending({
        id: "invite-1",
        code: "ABC123",
        created_at: "2026-04-10T00:00:00.000Z",
        expires_at: "2099-01-01T00:00:00.000Z",
        status: "pending",
      })
    ).toBe(true);

    expect(
      isParentInvitePending({
        id: "invite-2",
        code: "ABC123",
        created_at: "2026-04-10T00:00:00.000Z",
        expires_at: "2020-01-01T00:00:00.000Z",
        status: "pending",
      })
    ).toBe(false);
  });
});
