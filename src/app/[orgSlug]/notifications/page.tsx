import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Button, Card, Badge, EmptyState, SoftDeleteButton } from "@/components/ui";
import { isOrgAdmin } from "@/lib/auth";

interface NotificationsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function NotificationsPage({ params }: NotificationsPageProps) {
  const { orgSlug } = await params;
  const supabase = await createClient();

  // Get org
  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .single();

  if (!org) notFound();

  // Check if user is admin
  const adminCheck = await isOrgAdmin(org.id);
  if (!adminCheck) {
    redirect(`/${orgSlug}`);
  }

  // Fetch notifications
  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getChannelBadge = (channel: string) => {
    switch (channel) {
      case "email":
        return <Badge variant="primary">Email</Badge>;
      case "sms":
        return <Badge variant="warning">SMS</Badge>;
      case "both":
        return <Badge variant="success">Email + SMS</Badge>;
      default:
        return <Badge>{channel}</Badge>;
    }
  };

  const formatAudience = (audience: string) => {
    switch (audience) {
      case "members":
        return "Members";
      case "alumni":
        return "Alumni";
      default:
        return "Members + Alumni";
    }
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Send announcements to your organization members"
        actions={
          <Link href={`/${orgSlug}/notifications/new`}>
            <Button>
              <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Send Notification
            </Button>
          </Link>
        }
      />

      {notifications && notifications.length > 0 ? (
        <div className="space-y-4">
          {notifications.map((notification) => (
            <Card key={notification.id} className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-foreground">{notification.title}</h3>
                    {getChannelBadge(notification.channel)}
                    <Badge variant="muted">{formatAudience(notification.audience)}</Badge>
                    {notification.sent_at && (
                      <Badge variant="success">Sent</Badge>
                    )}
                  </div>
                  {notification.body && (
                    <p className="text-muted-foreground text-sm line-clamp-2 mb-3">
                      {notification.body}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Created {formatDate(notification.created_at)}
                    {notification.sent_at && ` • Sent ${formatDate(notification.sent_at)}`}
                  </p>
                </div>
                <SoftDeleteButton
                  table="notifications"
                  id={notification.id}
                  organizationField="organization_id"
                  organizationId={org.id}
                  redirectTo={`/${orgSlug}/notifications`}
                  label="Delete"
                />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={
            <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          }
          title="No notifications sent yet"
          description="Send your first notification to organization members"
          action={
            <Link href={`/${orgSlug}/notifications/new`}>
              <Button>Send Notification</Button>
            </Link>
          }
        />
      )}
    </div>
  );
}

