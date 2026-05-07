import {
  INITIAL_PROFILE_FORM_VALUES,
  buildAlumniProfileUpdate,
  buildAuthMetadataUpdate,
  buildMemberProfileUpdate,
  buildParentProfileUpdate,
  buildProfileFormValues,
  resolveProfileOrganization,
  toEditableProfileRole,
  validateProfileForm,
} from "../../src/lib/profile";

describe("mobile profile helpers", () => {
  describe("toEditableProfileRole", () => {
    it("maps member-like roles to member", () => {
      expect(toEditableProfileRole("admin")).toBe("member");
      expect(toEditableProfileRole("active_member")).toBe("member");
      expect(toEditableProfileRole("member")).toBe("member");
    });

    it("maps alumni-like roles to alumni", () => {
      expect(toEditableProfileRole("alumni")).toBe("alumni");
      expect(toEditableProfileRole("viewer")).toBe("alumni");
    });

    it("preserves parent and rejects unknown roles", () => {
      expect(toEditableProfileRole("parent")).toBe("parent");
      expect(toEditableProfileRole("coach")).toBeNull();
      expect(toEditableProfileRole(null)).toBeNull();
    });
  });

  describe("resolveProfileOrganization", () => {
    const organizations = [
      { id: "org-1", slug: "alpha", name: "Alpha" },
      { id: "org-2", slug: "beta", name: "Beta" },
    ];

    it("prefers the route slug when available", () => {
      expect(resolveProfileOrganization(organizations, "beta", null)?.id).toBe("org-2");
    });

    it("falls back to the manually selected slug", () => {
      expect(resolveProfileOrganization(organizations, null, "alpha")?.id).toBe("org-1");
    });

    it("auto-selects when only one organization exists", () => {
      expect(resolveProfileOrganization([organizations[0]], null, null)?.id).toBe("org-1");
    });

    it("requires selection when multiple organizations exist and no slug is provided", () => {
      expect(resolveProfileOrganization(organizations, null, null)).toBeNull();
    });
  });

  describe("buildProfileFormValues", () => {
    it("builds member defaults from the org row", () => {
      const values = buildProfileFormValues(
        "member",
        {
          id: "m1",
          created_at: null,
          deleted_at: null,
          email: "member@example.com",
          expected_graduation_date: "2027-06-01",
          first_name: "Mia",
          graduated_at: null,
          graduation_warning_sent_at: null,
          graduation_year: 2027,
          last_name: "Member",
          linkedin_url: "https://www.linkedin.com/in/mia-member",
          organization_id: "org-1",
          photo_url: null,
          role: "active_member",
          status: "active",
          updated_at: null,
          user_id: "user-1",
        },
        { email: "member@example.com", user_metadata: { name: "Fallback Name" } }
      );

      expect(values.first_name).toBe("Mia");
      expect(values.expected_graduation_date).toBe("2027-06-01");
      expect(values.linkedin_url).toContain("linkedin.com");
    });

    it("falls back to auth metadata when parent names are missing", () => {
      const values = buildProfileFormValues(
        "parent",
        {
          id: "p1",
          created_at: "2026-01-01T00:00:00.000Z",
          deleted_at: null,
          email: null,
          first_name: "",
          last_name: "",
          linkedin_url: null,
          notes: null,
          organization_id: "org-1",
          phone_number: null,
          photo_url: null,
          relationship: "Guardian",
          student_name: "Casey Student",
          updated_at: "2026-01-01T00:00:00.000Z",
          user_id: "user-1",
        },
        { email: "parent@example.com", user_metadata: { name: "Pat Parent" } }
      );

      expect(values.first_name).toBe("Pat");
      expect(values.last_name).toBe("Parent");
      expect(values.student_name).toBe("Casey Student");
    });
  });

  describe("validateProfileForm", () => {
    it("accepts a valid member profile", () => {
      const result = validateProfileForm("member", {
        ...INITIAL_PROFILE_FORM_VALUES,
        first_name: "Mia",
        last_name: "Member",
        graduation_year: "2027",
        expected_graduation_date: "2027-06-01",
        linkedin_url: "https://www.linkedin.com/in/mia-member",
      });

      expect(result.success).toBe(true);
    });

    it("rejects invalid LinkedIn URLs", () => {
      const result = validateProfileForm("alumni", {
        ...INITIAL_PROFILE_FORM_VALUES,
        first_name: "Ali",
        last_name: "Alumni",
        linkedin_url: "https://example.com/not-linkedin",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("LinkedIn");
      }
    });
  });

  describe("payload builders", () => {
    it("builds auth metadata from first and last name", () => {
      expect(
        buildAuthMetadataUpdate(
          { first_name: "Pat", last_name: "Parent" },
          "https://cdn.example.com/avatar.jpg"
        )
      ).toEqual({
        first_name: "Pat",
        last_name: "Parent",
        name: "Pat Parent",
        avatar_url: "https://cdn.example.com/avatar.jpg",
      });
    });

    it("builds member payloads with null normalization", () => {
      const payload = buildMemberProfileUpdate(
        {
          ...INITIAL_PROFILE_FORM_VALUES,
          first_name: "Mia",
          last_name: "Member",
          graduation_year: "2027",
          expected_graduation_date: "",
          linkedin_url: "",
        },
        "https://cdn.example.com/avatar.jpg"
      );

      expect(payload).toMatchObject({
        first_name: "Mia",
        last_name: "Member",
        graduation_year: 2027,
        expected_graduation_date: null,
        linkedin_url: null,
        photo_url: "https://cdn.example.com/avatar.jpg",
      });
    });

    it("builds alumni and parent payloads for role-specific fields", () => {
      const alumniPayload = buildAlumniProfileUpdate(
        {
          ...INITIAL_PROFILE_FORM_VALUES,
          first_name: "Ali",
          last_name: "Alumni",
          current_company: "Acme",
          phone_number: "",
        },
        null
      );
      const parentPayload = buildParentProfileUpdate(
        {
          ...INITIAL_PROFILE_FORM_VALUES,
          first_name: "Pat",
          last_name: "Parent",
          student_name: "Casey Student",
          relationship: "Guardian",
        },
        "https://cdn.example.com/parent.jpg"
      );

      expect(alumniPayload.current_company).toBe("Acme");
      expect(alumniPayload.phone_number).toBeNull();
      expect(parentPayload.student_name).toBe("Casey Student");
      expect(parentPayload.photo_url).toBe("https://cdn.example.com/parent.jpg");
    });
  });
});
