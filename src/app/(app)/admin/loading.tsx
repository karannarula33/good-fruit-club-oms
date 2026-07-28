import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-6 w-24" />
      <div className="flex flex-wrap gap-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-5 w-24" />
        ))}
      </div>
    </div>
  );
}
