import { canEditParentRecord, getEditParentRedirectPath } from "@/lib/parents-edit";

describe("parents edit helpers", () => {
  describe("getEditParentRedirectPath", () => {
    it("redirects missing parentId routes to the org parents list", () => {
      expect(
        getEditParentRedirectPath({
          orgSlug: "org-slug",
          orgId: "org-1",
          parentId: undefined,
          hasParentsAccess: true,
        })
      ).toBe("/(app)/org-slug/parents");
    });

    it("redirects users without parents access to the org parents list", () => {
      expect(
        getEditParentRedirectPath({
          orgSlug: "org-slug",
          orgId: "org-1",
          parentId: "parent-1",
          hasParentsAccess: false,
        })
      ).toBe("/(app)/org-slug/parents");
    });

    it("falls back to app home when org slug is unavailable", () => {
      expect(
        getEditParentRedirectPath({
          orgSlug: "",
          orgId: null,
          parentId: "parent-1",
          hasParentsAccess: false,
        })
      ).toBe("/(app)");
    });

    it("does not redirect when the route is valid and accessible", () => {
      expect(
        getEditParentRedirectPath({
          orgSlug: "org-slug",
          orgId: "org-1",
          parentId: "parent-1",
          hasParentsAccess: true,
        })
      ).toBeNull();
    });
  });

  describe("canEditParentRecord", () => {
    it("allows admins to edit any parent", () => {
      expect(
        canEditParentRecord({
          role: "admin",
          currentUserId: "user-1",
          parentUserId: "other-user",
        })
      ).toBe(true);
    });

    it("allows parent users to edit their own record", () => {
      expect(
        canEditParentRecord({
          role: "parent",
          currentUserId: "user-1",
          parentUserId: "user-1",
        })
      ).toBe(true);
    });

    it("prevents parent users from editing someone else's record", () => {
      expect(
        canEditParentRecord({
          role: "parent",
          currentUserId: "user-1",
          parentUserId: "user-2",
        })
      ).toBe(false);
    });
  });
});
