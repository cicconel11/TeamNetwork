import Link from "next/link";
import { Button } from "@/components/ui";

export default function OrgNotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="text-center">
        <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-6">
          <svg className="h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Organization Not Found</h1>
        <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
          We couldn&apos;t find the organization you&apos;re looking for. It may have been removed or the URL is incorrect.
        </p>
        <Link href="/">
          <Button>Browse Organizations</Button>
        </Link>
      </div>
    </div>
  );
}

