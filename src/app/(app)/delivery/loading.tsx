import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function DeliveryLoading() {
  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-9 w-32" />
          </Card>
        ))}
      </div>
    </div>
  );
}
