import { Card, Skeleton } from "@/components/ui";

export default function ConnectedAccountsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-2xl font-bold text-foreground">Connected Accounts</h1>
        <p className="text-muted-foreground">
          Manage third-party accounts linked to your profile.
        </p>
      </div>
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
        <Skeleton className="h-8 w-32" />
      </Card>
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
      </Card>
    </div>
  );
}
