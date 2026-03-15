import { Card } from "@/components/ui";

export default function LinkedInSettingsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-2xl font-bold text-foreground">LinkedIn</h1>
        <p className="text-muted-foreground">
          Manage your LinkedIn profile URL and connection.
        </p>
      </div>
      <Card className="p-5 text-muted-foreground text-sm">Loading…</Card>
    </div>
  );
}
