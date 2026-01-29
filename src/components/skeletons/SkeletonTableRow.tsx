import { Skeleton } from "@/components/ui";

interface SkeletonTableRowProps {
  columns?: number;
}

export function SkeletonTableRow({ columns = 5 }: SkeletonTableRowProps) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="p-4">
          <Skeleton className={`h-4 ${i === 0 ? "w-32" : i === columns - 1 ? "w-16 ml-auto" : "w-24"}`} />
          {i === 0 && <Skeleton className="h-3 w-24 mt-1" />}
        </td>
      ))}
    </tr>
  );
}
