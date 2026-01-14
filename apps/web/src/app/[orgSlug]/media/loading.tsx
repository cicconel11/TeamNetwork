export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Header skeleton */}
      <div className="mb-8">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-4 w-80 bg-muted rounded animate-pulse mt-2" />
      </div>

      {/* Filter bar skeleton */}
      <div className="flex items-center gap-3 mb-6">
        <div className="h-9 w-16 bg-muted rounded-full animate-pulse" />
        <div className="h-9 w-20 bg-muted rounded-full animate-pulse" />
        <div className="h-9 w-20 bg-muted rounded-full animate-pulse" />
        <div className="ml-auto h-9 w-28 bg-muted rounded animate-pulse" />
      </div>

      {/* Grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border overflow-hidden">
            <div className="aspect-[4/3] bg-muted animate-pulse" />
            <div className="p-3 space-y-2">
              <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
              <div className="h-3 w-1/2 bg-muted rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
