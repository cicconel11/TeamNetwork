import { ListPageSkeleton } from "@/components/skeletons/pages/ListPageSkeleton";

export default function EnterpriseLoading() {
  return <ListPageSkeleton itemCount={4} lines={2} showFilters />;
}
