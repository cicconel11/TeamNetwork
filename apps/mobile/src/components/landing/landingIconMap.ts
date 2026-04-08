/**
 * Maps string icon keys (from @teammeet/core marketing data) to lucide-react-native components.
 *
 * Named imports only — no `import * as` — so the bundler can tree-shake unused icons.
 */

import {
  Users,
  Calendar,
  Trophy,
  MessageSquare,
  FileText,
  DollarSign,
  type LucideIcon,
} from "lucide-react-native";

export const LANDING_ICONS: Record<string, LucideIcon> = {
  users: Users,
  calendar: Calendar,
  trophy: Trophy,
  "message-square": MessageSquare,
  "file-text": FileText,
  "dollar-sign": DollarSign,
};

export function resolveLandingIcon(key: string): LucideIcon {
  return LANDING_ICONS[key] ?? Users;
}
