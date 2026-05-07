import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";

interface MemberHighlight {
  id: string;
  first_name: string;
  last_name: string;
  photo_url: string | null;
  created_at: string | null;
}

interface MemberHighlightsWidgetProps {
  members: MemberHighlight[];
  orgSlug: string;
}

function formatJoinDate(dateString: string): { text: string; isRecent: boolean } {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return { text: "Joined today", isRecent: true };
  if (diffDays === 1) return { text: "Joined yesterday", isRecent: true };
  if (diffDays < 7) return { text: `Joined ${diffDays}d ago`, isRecent: true };
  if (diffDays < 30) return { text: `Joined ${diffDays}d ago`, isRecent: false };
  return { text: `Joined ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, isRecent: false };
}

export function MemberHighlightsWidget({ members, orgSlug }: MemberHighlightsWidgetProps) {
  if (members.length === 0) {
    return (
      <Card className="rounded-xl border-border/70 bg-card/75 p-4 shadow-none backdrop-blur-sm">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">New Members</h3>
        <p className="text-sm text-muted-foreground/60 mt-3">No recent members</p>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border-border/70 bg-card/75 p-4 shadow-none backdrop-blur-sm">
      <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">New Members</h3>
      <ul className="space-y-1 mt-3 stagger-children">
        {members.map((member) => {
          const joinInfo = member.created_at ? formatJoinDate(member.created_at) : null;
          return (
            <li key={member.id}>
              <Link
                href={`/${orgSlug}/members/${member.id}`}
                className="-mx-2 flex items-center gap-3 rounded-lg p-2 transition-all duration-200 hover:bg-muted/35"
              >
                <div className="relative flex-shrink-0">
                  <Avatar
                    src={member.photo_url}
                    name={`${member.first_name} ${member.last_name}`}
                    size="sm"
                  />
                  {joinInfo?.isRecent && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-org-secondary rounded-full border-2 border-card" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-foreground font-medium truncate">
                    {member.first_name} {member.last_name}
                  </p>
                  {joinInfo && (
                    <p className="text-xs text-muted-foreground">{joinInfo.text}</p>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        href={`/${orgSlug}/members`}
        className="mt-3 flex items-center gap-1 border-t border-border/40 pt-3 text-xs text-muted-foreground transition-colors duration-200 hover:text-foreground"
      >
        See all members <span aria-hidden="true">→</span>
      </Link>
    </Card>
  );
}
