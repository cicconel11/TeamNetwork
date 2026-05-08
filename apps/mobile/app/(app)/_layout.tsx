import { AppDrawer } from "@/navigation/AppDrawer";
import { OrgProvider } from "@/contexts/OrgContext";
import { PresenceProvider } from "@/contexts/PresenceContext";

export default function AppLayout() {
  return (
    <OrgProvider>
      <PresenceProvider>
        <AppDrawer />
      </PresenceProvider>
    </OrgProvider>
  );
}
