import { TablePageSkeleton } from "@/components/skeletons/pages";

export default function Loading() {
  return <TablePageSkeleton showStats statsCount={3} columns={5} rowCount={5} />;
}
