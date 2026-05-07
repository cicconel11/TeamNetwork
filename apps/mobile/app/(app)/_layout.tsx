import { AppDrawer } from "@/navigation/AppDrawer";
import { OrgProvider } from "@/contexts/OrgContext";

export default function AppLayout() {
  return (
    <OrgProvider>
      <AppDrawer />
    </OrgProvider>
  );
}
