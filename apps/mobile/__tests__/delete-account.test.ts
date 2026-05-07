import fs from "fs";
import path from "path";

const deleteAccountScreenSource = fs.readFileSync(
  path.join(__dirname, "../app/(app)/(drawer)/delete-account.tsx"),
  "utf8"
);

const drawerContentSource = fs.readFileSync(
  path.join(__dirname, "../src/navigation/DrawerContent.tsx"),
  "utf8"
);

describe("delete-account regressions", () => {
  it("uses the shared Supabase sign-out flow instead of the auth-context wrapper", () => {
    expect(deleteAccountScreenSource).toContain('import { signOut } from "@/lib/supabase";');
    expect(deleteAccountScreenSource).not.toContain('const { signOut } = useAuth();');
  });

  it("handles missing back history by falling back to the current org or organizations", () => {
    expect(deleteAccountScreenSource).toContain("if (router.canGoBack()) {");
    expect(deleteAccountScreenSource).toContain("router.back();");
    expect(deleteAccountScreenSource).toContain('router.replace(`/(app)/${params.currentSlug}/(tabs)`);');
    expect(deleteAccountScreenSource).toContain('router.replace("/(app)");');
  });

  it("navigates to delete-account with push semantics so back navigation still exists", () => {
    expect(drawerContentSource).toContain('item.href === "/(app)/(drawer)/delete-account"');
    expect(drawerContentSource).toContain("router.push({");
    expect(drawerContentSource).toContain("params: slug ? { currentSlug: slug } : undefined");
  });

  it("keeps explicit accessibility labels on the back and destructive action buttons", () => {
    expect(deleteAccountScreenSource).toContain('accessibilityLabel="Go back"');
    expect(deleteAccountScreenSource).toContain('accessibilityLabel="Delete my account"');
    expect(deleteAccountScreenSource).toContain('accessibilityLabel="Cancel account deletion"');
  });
});
