import { useEffect } from "react";
import { useRouter } from "expo-router";
import LoadingScreen from "@/components/LoadingScreen";
import { useOrg } from "@/contexts/OrgContext";
import { getScheduleMySettingsPath } from "@/lib/schedules/mobile-schedule-settings";

export default function SchedulesRedirectScreen() {
  const router = useRouter();
  const { orgSlug } = useOrg();

  useEffect(() => {
    if (!orgSlug) return;
    router.replace(getScheduleMySettingsPath(orgSlug));
  }, [orgSlug, router]);

  return <LoadingScreen />;
}
